// Aus Job Radar: live job aggregator for the Australian market.
// No dependencies. Needs Node 18+ (built-in fetch).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const { ADZUNA_APP_ID, ADZUNA_APP_KEY, JOOBLE_KEY } = process.env;
const companies = JSON.parse(fs.readFileSync(path.join(__dirname, 'companies.json'), 'utf8'));
let companyInfo = {};
try { companyInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'companyInfo.json'), 'utf8')); } catch (e) {}

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adzuna(p, q) {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) return null;
  const pages = Math.max(1, Math.min(p.adzunaPages || 1, 5));
  const out = [];
  let titleOnly = !!q; // match the role words in the job title only, so results stay on topic
  for (let page = 1; page <= pages; page++) {
    const fetchPage = (useTitle) => {
      const u = new URL(`https://api.adzuna.com/v1/api/jobs/au/search/${page}`);
      u.searchParams.set('app_id', ADZUNA_APP_ID);
      u.searchParams.set('app_key', ADZUNA_APP_KEY);
      u.searchParams.set('results_per_page', '50');
      u.searchParams.set('sort_by', 'date');
      if (q) u.searchParams.set(useTitle ? 'title_only' : 'what', q);
      if (p.where) u.searchParams.set('where', p.where);
      if (p.days) u.searchParams.set('max_days_old', String(p.days));
      if (p.salaryMin) u.searchParams.set('salary_min', String(p.salaryMin));
      return cached(u.toString(), 5 * 60e3, () => getJSON(u));
    };
    let data;
    try {
      try {
        data = await fetchPage(titleOnly);
      } catch (e) {
        // if Adzuna rejects title_only, fall back to a normal keyword search
        if (titleOnly && /HTTP 400/.test(String(e.message))) { titleOnly = false; data = await fetchPage(false); }
        else throw e;
      }
    } catch (e) {
      if (page === 1) throw e; // nothing fetched yet: report the failure
      break; // keep what earlier pages returned
    }
    const rows = data.results || [];
    out.push(...rows.map((j) => ({
      title: strip(j.title),
      company: j.company?.display_name || '',
      location: j.location?.display_name || '',
      salary: (j.salary_is_predicted === '1' ? 'est. ' : '') + fmtSalary(j.salary_min, j.salary_max),
      salaryMin: j.salary_min || null,
      salaryEstimated: j.salary_is_predicted === '1',
      url: j.redirect_url,
      posted: j.created || null,
      source: 'Adzuna',
      category: (j.category?.label || '').replace(/ Jobs$/i, ''),
      jobTypeRaw: [j.contract_time, j.contract_type].filter(Boolean).join(' ').replace(/_/g, ' '),
      snippet: strip(j.description),
    })));
    if (rows.length < 50) break;
    await sleep(300);
  }
  return out;
}

async function jooble(p, q) {
  if (!JOOBLE_KEY) return null;
  const pages = Math.max(1, Math.min(p.jooblePages || 1, 5));
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const body = JSON.stringify({ keywords: q, location: p.where || 'Australia', page });
    let data;
    try {
      data = await cached('jooble|' + body, 5 * 60e3, () =>
        getJSON('https://jooble.org/api/' + JOOBLE_KEY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
      );
    } catch (e) {
      if (page === 1) throw e;
      break;
    }
    const rows = data.jobs || [];
    out.push(...rows.map((j) => ({
      title: strip(j.title),
      company: j.company || '',
      location: j.location || '',
      salary: j.salary || '',
      salaryMin: null,
      url: j.link,
      posted: j.updated || null,
      source: 'Jooble',
      category: '',
      jobTypeRaw: j.type || '',
      snippet: strip(j.snippet),
    })));
    if (rows.length < 10) break;
    await sleep(300);
  }
  return out;
}

const wp = (v) => {
  const t = String(v || '').toLowerCase();
  return t.includes('remote') ? 'remote' : t.includes('hybrid') ? 'hybrid' : '';
};

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
      workplace: wp(j.workplaceType),
      jobTypeRaw: j.categories?.commitment || '',
      snippet: (j.descriptionPlain || '').slice(0, 400),
    })),
  ashby: async (s) =>
    (await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${s}`)).jobs.map((j) => ({
      title: j.title,
      location: j.location || '',
      url: j.jobUrl,
      posted: j.publishedAt || null,
      workplace: j.isRemote === true ? 'remote' : wp(j.workplaceType),
      jobTypeRaw: String(j.employmentType || '').replace(/([a-z])([A-Z])/g, '$1 $2'),
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

// ---------- derived fields ----------
const AGENCY_RE = /\b(hays|robert half|michael page|page personnel|randstad|hudson|adecco|manpower|kelly services|programmed|chandler macleod|talent international|peoplebank|davidson|frazer jones|people2people|career moves|six degrees|aston carter|lawson williams|beyond recruitment|recruit(ment|ing|er|ers)?|staffing|executive search|search & selection|labour hire)\b/i;
const TITLE_REMOTE = /\b(remote|work from home|wfh|work from anywhere)\b/i;
const TEXT_REMOTE = /\b(fully remote|100% remote|remote[- ]first|remote role|remote position|remote work|work remotely|work from home|wfh)\b/i;

function workplaceOf(j) {
  if (j.workplace) return j.workplace;
  const head = `${j.title} ${j.location}`;
  const all = `${head} ${j.snippet || ''}`;
  if (/\bhybrid\b/i.test(all)) return 'hybrid';
  if (TITLE_REMOTE.test(head) || TEXT_REMOTE.test(all)) return 'remote';
  return 'unknown';
}

function jobTypeOf(j) {
  const raw = `${j.jobTypeRaw || ''}`.toLowerCase();
  const title = (j.title || '').toLowerCase();
  const text = `${title} ${(j.snippet || '').toLowerCase()}`;
  if (/part/.test(raw) || /\bpart[- ]time\b/.test(title)) return 'part-time';
  if (/casual/.test(raw) || /\bcasual\b/.test(title)) return 'casual';
  if (/contract|temp|fixed/.test(raw) || /\b(contract|contractor|fixed[- ]term|temporary|temp)\b/.test(title)) return 'contract';
  if (/full/.test(raw) || /\bfull[- ]time\b/.test(title)) return 'full-time';
  if (/\bpart[- ]time\b/.test(text)) return 'part-time';
  if (/\bcasual\b/.test(text)) return 'casual';
  if (/\b(fixed[- ]term|12[- ]month contract|6[- ]month contract|contract role)\b/.test(text)) return 'contract';
  if (/\bfull[- ]time\b/.test(text)) return 'full-time';
  return 'unknown';
}

function levelOf(title) {
  const t = (title || '').toLowerCase();
  if (/\b(head of|director|vp|vice president|chief|principal|general manager)\b/.test(t)) return 'leadership';
  if (/\b(manager|team leader|team lead|lead|supervisor)\b/.test(t)) return 'manager';
  if (/\b(senior|sr|staff)\b/.test(t)) return 'senior';
  if (/\b(intern|graduate|junior|jr|entry|trainee|apprentice|cadet)\b/.test(t)) return 'entry';
  return 'mid';
}

const normCo = (s) =>
  (s || '').toLowerCase().replace(/\b(pty|ltd|limited|inc|group|holdings|australia|australasia|aus|nz)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const sizeIndex = Object.entries(companyInfo).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [normCo(k), v]).filter(([k]) => k);

function sizeOf(company) {
  const c = normCo(company);
  if (!c) return 'unknown';
  const hit = sizeIndex.find(([k]) => c === k || c.startsWith(k + ' '));
  return hit && hit[1].size ? hit[1].size : 'unknown';
}

function enrich(j) {
  const blob = `${j.company} ${j.companyIndustry || ''} ${j.snippet || ''}`;
  j.industries = Object.keys(INDUSTRY).filter((k) => INDUSTRY[k].test(blob));
  j.workplace = workplaceOf(j);
  j.jobType = jobTypeOf(j);
  j.level = levelOf(j.title);
  j.agency = AGENCY_RE.test(j.company || '');
  j.size = sizeOf(j.company);
  j.category = j.category || '';
  delete j.snippet;
  delete j.companyIndustry;
  delete j.jobTypeRaw;
  return j;
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
    if (j.source !== 'Adzuna' && !matchesQuery(j, alts)) return false;
    if (excl.some((r) => r.test(j.title))) return false;
    if (cutoff && j.posted && new Date(j.posted).getTime() < cutoff) return false;
    if (p.salaryMin && j.salaryMin != null && j.salaryMin < p.salaryMin) return false;
    if (ind && !ind.test(`${j.company} ${j.companyIndustry || ''} ${j.snippet || ''}`)) return false;
    return true;
  });

  jobs = dedupe(jobs).sort((a, b) => new Date(b.posted || 0) - new Date(a.posted || 0));
  jobs.forEach((j) => {
    j.id = Buffer.from(j.url).toString('base64').slice(-24);
    enrich(j);
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

module.exports = { search, enrich };
