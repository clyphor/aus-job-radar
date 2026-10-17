// Collects jobs and writes docs/jobs.json.
//   1. Every role keyword in searches.json (Adzuna, Jooble, company career pages).
//   2. Adzuna job categories (Accounting, IT, Sales and so on), a few per run on a rotation
//      so the free Adzuna call limit is not used up. Set FULL=1 to fetch all categories at once.
// Run by the GitHub Action on a schedule; can also be run by hand: node scripts/fetch.js
const fs = require('fs');
const path = require('path');
const { search, collectCategory, adzunaCategories, companyBoards, finalize, dedupe } = require('../server.js');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'searches.json'), 'utf8'));
const OUT = process.env.JOBS_OUT || path.join(__dirname, '..', 'docs', 'jobs.json');
const FULL = process.env.FULL === '1' || process.env.FULL === 'true';
const hasAdzuna = !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);

// source name in the status list -> value of job.source
const SOURCE_OF = { Adzuna: 'Adzuna', 'Adzuna categories': 'Adzuna', Jooble: 'Jooble', 'Company sites': 'Company site' };

(async () => {
  const byId = new Map();
  const sources = new Map();
  const fetched = {}; // rows received from each source before merging duplicates
  const add = (j) => {
    fetched[j.source] = (fetched[j.source] || 0) + 1;
    const old = byId.get(j.id);
    if (!old || (!old.salary && j.salary)) byId.set(j.id, j);
  };
  const stat = (name, ok, count, note) => {
    const cur = sources.get(name) || { name, ok: true, count: 0, note: '' };
    cur.ok = cur.ok && ok;
    cur.count += count || 0;
    cur.note = cur.note || note || '';
    sources.set(name, cur);
  };

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}

  // ---- 1. role keywords ----
  for (const q of cfg.roles) {
    const r = await search({
      q,
      where: '',
      industry: '',
      exclude: [],
      days: cfg.days || 30,
      salaryMin: 0,
      sources: ['adzuna', 'jooble'],
      adzunaPages: cfg.adzunaPages || 1,
      jooblePages: cfg.jooblePages || 1,
      limit: 5000,
    });
    r.results.forEach(add);
    r.sources.forEach((s) => stat(s.name, s.ok, s.count, s.note));
    console.log(`${q}: ${r.results.length} roles`);
  }

  // ---- 1b. company career pages: every open role, not only keyword matches ----
  try {
    const { jobs: cj, failed } = await companyBoards();
    const rows = finalize(dedupe(cj.filter((j) => j.title && j.url)));
    rows.forEach(add);
    stat('Company sites', true, rows.length, failed.length ? `${failed.length} boards unreachable` : '');
    console.log(`company sites: ${rows.length} roles (${failed.length} boards unreachable)`);
  } catch (e) {
    stat('Company sites', false, 0, String(e.message || e));
  }

  // ---- 2. Adzuna categories ----
  let categories = (previous && previous.categories) || [];
  const refreshed = new Set();
  if (hasAdzuna) {
    try {
      const fresh = await adzunaCategories();
      if (fresh && fresh.length) categories = fresh;
    } catch (e) {
      console.error('Could not list Adzuna categories:', e.message);
    }
    const per = cfg.categoriesPerRun || 8;
    const groups = Math.max(1, Math.ceil(categories.length / per));
    const slot = Math.floor(Date.now() / ((cfg.runEveryHours || 4) * 3600e3)) % groups;
    const todo = FULL ? categories : categories.slice(slot * per, slot * per + per);
    for (const c of todo) {
      try {
        const rows = await collectCategory(c.tag, { pages: cfg.categoryPages || 1, days: cfg.days || 30 });
        if (rows === null) continue;
        rows.forEach(add);
        refreshed.add(c.label);
        stat('Adzuna categories', true, rows.length, '');
        console.log(`category ${c.label}: ${rows.length} roles`);
      } catch (e) {
        stat('Adzuna categories', false, 0, String(e.message || e));
        console.error(`category ${c.label} failed: ${e.message}`);
        if (/HTTP (401|403|429)/.test(String(e.message))) break; // key problem or rate limit: stop early
      }
    }
  }

  // ---- keep older jobs where this run could not refresh them ----
  if (previous && previous.jobs) {
    const failedLabels = new Set([...sources.values()].filter((s) => !s.ok).map((s) => SOURCE_OF[s.name]));
    const carryCut = Date.now() - (cfg.carryDays || 14) * 864e5;
    const days = Date.now() - (cfg.days || 30) * 864e5;
    let kept = 0;
    for (const j of previous.jobs) {
      if (byId.has(j.id)) continue;
      const cut = failedLabels.has(j.source) ? days : carryCut;
      const sourceFailed = failedLabels.has(j.source);
      // Adzuna jobs in a category we did not refresh this run are kept until the category's turn comes round
      const categoryWaiting = j.source === 'Adzuna' && hasAdzuna && j.category && !refreshed.has(j.category);
      if (!sourceFailed && !categoryWaiting) continue;
      if (j.posted && new Date(j.posted).getTime() < cut) continue;
      byId.set(j.id, j);
      kept++;
    }
    if (kept) console.log(`Kept ${kept} older roles that this run did not refresh.`);
  }

  let jobs = [...byId.values()].sort((a, b) => new Date(b.posted || 0) - new Date(a.posted || 0));

  // Some advertisers post hundreds of near-identical ads (for example delivery drivers). Keep the newest few
  // per company from the job boards so they do not crowd out everything else. Career pages are never capped.
  const cap = cfg.maxPerCompany || 0;
  let capped = 0;
  if (cap) {
    const per = new Map();
    jobs = jobs.filter((j) => {
      if (j.source === 'Company site' || !j.company) return true;
      const k = `${j.source}|${j.company.toLowerCase()}`;
      const n = (per.get(k) || 0) + 1;
      per.set(k, n);
      if (n > cap) { capped++; return false; }
      return true;
    });
    if (capped) console.log(`Skipped ${capped} extra ads from companies with more than ${cap} ads.`);
  }

  // Never replace a good list with an empty one (for example during an API outage).
  if (!jobs.length && previous && previous.jobs && previous.jobs.length) {
    console.error('No jobs came back. Keeping the previous list.');
    process.exit(1);
  }

  const same = previous && JSON.stringify(previous.jobs) === JSON.stringify(jobs);
  const out = {
    updated: same ? previous.updated : new Date().toISOString(),
    count: jobs.length,
    sources: [...sources.values()],
    categories,
    stats: Object.keys(fetched).map((source) => ({
      source,
      fetched: fetched[source],
      kept: jobs.filter((j) => j.source === source).length,
    })),
    capped,
    jobs,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`${jobs.length} roles saved${same ? ' (unchanged)' : ''}.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
