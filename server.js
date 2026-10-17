// Aus Job Radar: live job aggregator for the Australian market.
// No dependencies. Needs Node 18+ (built-in fetch).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const { ADZUNA_APP_ID, ADZUNA_APP_KEY, JOOBLE_KEY } = process.env;
const companies = JSON.parse(fs.readFileSync(path.join(__dirname, 'companies.json'), 'utf8'));

// ---------- helpers ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

async function getJSON(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctl.signal,
      headers: { 'User-Agent': 'AusJobRadar/1.0', ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const strip = (h) =>
  (h || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fmtSalary = (min, max) => {
  const k = (n) => '$' + Math.round(n / 1000) + 'k';
  if (min && max && Math.round(min) !== Math.round(max)) return `${k(min)} to ${k(max)}`;
  if (min || max) return k(min || max);
  return '';
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- sources ----------
async function adzuna(p, q) {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) return null;
  const u = new URL('https://api.adzuna.com/v1/api/jobs/au/search/1');
  u.searchParams.set('app_id', ADZUNA_APP_ID);
  u.searchParams.set('app_key', ADZUNA_APP_KEY);
  u.searchParams.set('results_per_page', '50');
  u.searchParams.set('sort_by', 'date');
  if (q) u.searchParams.set('what', q);
  if (p.where) u.searchParams.set('where', p.where);
  if (p.days) u.searchParams.set('max_days_old', String(p.days));
  if (p.salaryMin) u.searchParams.set('salary_min', String(p.salaryMin));
  const data = await cached(u.toString(), 2 * 60e3, () => getJSON(u));
  return (data.results || []).map((j) => ({
    title: strip(j.title),
    company: j.company?.display_name || '',
    location: j.location?.display_name || '',
    salary: fmtSalary(j.salary_min, j.salary_max),
    salaryMin: j.salary_min || null,
    url: j.redirect_url,
    posted: j.created || null,
    source: 'Adzuna',
    snippet: strip(j.description),
  }));
}

async function jooble(p, q) {
  if (!JOOBLE_KEY) return null;
  const body = JSON.stringify({ keywords: q, location: p.where || 'Australia', page: 1 });
  const data = await cached('jooble|' + body, 2 * 60e3, () =>
    getJSON('https://jooble.org/api/' + JOOBLE_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  );
  return (data.jobs || []).map((j) => ({
    title: strip(j.title),
    company: j.company || '',
    location: j.location || '',
    salary: j.salary || '',
    salaryMin: null,
    url: j.link,
    posted: j.updated || null,
    source: 'Jooble',
    snippet: strip(j.snippet),
  }));
}

const atsFetchers = {
  greenhouse: async (s) =>
    (await getJSON(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`)).jobs.map((j) => ({
      title: j.title,
      location: j.location?.name || '',
      url: j.absolute_url,
      posted: j.updated_at || null,
      snippet: '',
    })),
  lever: async (s) =>
    (await getJSON(`https://api.lever.co/v0/postings/${s}?mode=json`)).map((j) => ({
      title: j.text,
      location: j.categories?.location || (j.categories?.allLocations || []).join(', '),
      url: j.hostedUrl,
      posted: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      snippet: (j.descriptionPlain || '').slice(0, 400),
    })),
  ashby: async (s) =>
    (await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${s}`)).jobs.map((j) => ({
      title: j.title,
      location: j.location || '',
      url: j.jobUrl,
      posted: j.publishedAt || null,
      snippet: strip(j.descriptionPlain || j.descriptionHtml).slice(0, 400),
    })),
};

async function companyBoards() {
  const failed = [];
  const lists = await Promise.all(
    companies.map(async (c) => {
      try {
        const fetcher = atsFetchers[c.ats];
        const jobs = await cached(`ats|${c.ats}|${c.slug}`, 10 * 60e3, () => fetcher(c.slug));
        return jobs.map((j) => ({
          ...j,
          company: c.name,
          companyIndustry: c.industry || '',
          salary: '',
          salaryMin: null,
          source: 'Company site',
        }));
      } catch (e) {
        failed.push(c.name);
        return [];
      }
    })
  );
  return { jobs: lists.flat(), failed };
}

// ---------- filtering ----------
const AU_RE = /australia|sydney|melbourne|brisbane|perth|adelaide|canberra|\bnsw\b|\bvic\b|\bqld\b|\bwa\b|\bsa\b|\banz\b|apac|remote/i;

function locationOk(loc, where) {
  const l = (loc || '').toLowerCase();
  if (!where) return AU_RE.test(l);
  const w = where.toLowerCase();
  return l.includes(w) || /^australia$|remote.*(australia|anz|apac)|(australia|anz|apac).*remote/.test(l);
}

function matchesQuery(j, alts) {
  if (!alts.length) return true;
  const t = j.title.toLowerCase();
  const all = t + ' ' + (j.snippet || '').toLowerCase();
  return alts.some((a) => {
    const w = a.toLowerCase().split(/\s+/);
    const inTitle = w.filter((x) => t.includes(x)).length;
    return inTitle === w.length || (inTitle >= Math.ceil(w.length / 2) && w.every((x) => all.includes(x)));
  });
}

const INDUSTRY = {
  saas: /saas|software|cloud|b2b|platform|tech|digital|fintech|startup|scale-?up/i,
  insurance: /insur|assurance|claims|underwrit|\biag\b|nrma|cgu|suncorp|aami|qbe|allianz|\bnib\b|medibank|zurich|youi|chubb|\baig\b|bupa|\bhcf\b|vero|hollard|budget direct|real insurance|auto & general/i,
  finance: /bank|finance|financial|lending|superannuation|wealth|payments|fintech/i,
  health: /health|medical|pharma|hospital|care/i,
};

function dedupe(jobs) {
  const seen = new Map();
  for (const j of jobs) {
    const k = [j.company, j.title, j.location].map((s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
    if (!seen.has(k) || (!seen.get(k).salary && j.salary)) seen.set(k, j);
  }
  return [...seen.values()];
}

// ---------- search ----------
async function search(p) {
  const t0 = Date.now();
  const alts = p.q.split(/\s+or\s+|,|\|/i).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const queries = alts.length ? alts : [''];
  const status = [];
  let jobs = [];

  const run = async (name, fn) => {
    try {
      const r = await fn();
      if (r === null) return status.push({ name, ok: false, note: 'no API key set' });
      status.push({ name, ok: true, count: r.length });
      jobs = jobs.concat(r);
    } catch (e) {
      status.push({ name, ok: false, note: String(e.message || e) });
    }
  };

  const tasks = [];
  if (p.sources.includes('adzuna'))
    tasks.push(run('Adzuna', async () => {
      const rs = await Promise.all(queries.map((q) => adzuna(p, q)));
      return rs.includes(null) ? null : rs.flat();
    }));
  if (p.sources.includes('jooble'))
    tasks.push(run('Jooble', async () => {
      const rs = await Promise.all(queries.map((q) => jooble(p, q)));
      return rs.includes(null) ? null : rs.flat();
    }));
  if (p.sources.includes('company'))
    tasks.push(
      (async () => {
        try {
          const { jobs: cj, failed } = await companyBoards();
          const ok = cj.filter((j) => locationOk(j.location, p.where));
          jobs = jobs.concat(ok);
          status.push({
            name: 'Company sites',
            ok: true,
            count: ok.length,
            note: failed.length ? `${failed.length} boards unreachable` : '',
          });
        } catch (e) {
          status.push({ name: 'Company sites', ok: false, note: String(e.message || e) });
        }
      })()
    );
  await Promise.all(tasks);

  const excl = p.exclude.map((x) => new RegExp('\\b' + esc(x) + '\\b', 'i'));
  const cutoff = p.days ? Date.now() - p.days * 864e5 : 0;
  const ind = INDUSTRY[p.industry];

  jobs = jobs.filter((j) => {
    if (!j.title || !j.url) return false;
    if (!matchesQuery(j, alts)) return false;
    if (excl.some((r) => r.test(j.title))) return false;
    if (cutoff && j.posted && new Date(j.posted).getTime() < cutoff) return false;
    if (p.salaryMin && j.salaryMin != null && j.salaryMin < p.salaryMin) return false;
    if (ind && !ind.test(`${j.company} ${j.companyIndustry || ''} ${j.snippet || ''}`)) return false;
    return true;
  });

  jobs = dedupe(jobs).sort((a, b) => new Date(b.posted || 0) - new Date(a.posted || 0));
  jobs.forEach((j) => {
    j.id = Buffer.from(j.url).toString('base64').slice(-24);
    const blob = `${j.company} ${j.companyIndustry || ''} ${j.snippet || ''}`;
    j.industries = Object.keys(INDUSTRY).filter((k) => INDUSTRY[k].test(blob));
    delete j.snippet;
    delete j.companyIndustry;
  });

  return { total: jobs.length, results: jobs.slice(0, p.limit || 200), sources: status, tookMs: Date.now() - t0 };
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/search') {
      const g = (k) => (url.searchParams.get(k) || '').trim();
      const p = {
        q: g('q'),
        where: g('where'),
        industry: g('industry'),
        exclude: g('exclude').split(',').map((s) => s.trim()).filter(Boolean),
        days: parseInt(g('days')) || 0,
        salaryMin: parseInt(g('salaryMin')) || 0,
        sources: (g('sources') || 'adzuna,jooble,company').split(','),
      };
      try {
        const out = await search(p);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
      return;
    }
    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.join(__dirname, 'public', path.normalize(file));
    if (!full.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(full)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });

// Run as a live server (Render, or `node server.js`). When required by
// scripts/fetch.js the server is not started and only search() is used.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Aus Job Radar running on http://localhost:${PORT}`);
    console.log(`Adzuna: ${ADZUNA_APP_ID ? 'on' : 'off (set ADZUNA_APP_ID / ADZUNA_APP_KEY)'}`);
    console.log(`Jooble: ${JOOBLE_KEY ? 'on' : 'off (set JOOBLE_KEY)'}`);
    console.log(`Company boards: ${companies.length} configured`);
  });
}

module.exports = { search };
