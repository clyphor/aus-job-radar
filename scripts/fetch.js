// Collects jobs for every role in searches.json and writes docs/jobs.json.
// Run by the GitHub Action on a schedule; can also be run by hand: node scripts/fetch.js
const fs = require('fs');
const path = require('path');
const { search } = require('../server.js');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'searches.json'), 'utf8'));
const OUT = path.join(__dirname, '..', 'docs', 'jobs.json');

(async () => {
  const byId = new Map();
  const sources = new Map();

  for (const q of cfg.roles) {
    const r = await search({
      q,
      where: '',
      industry: '',
      exclude: [],
      days: cfg.days || 30,
      salaryMin: 0,
      sources: ['adzuna', 'jooble', 'company'],
      limit: 1000,
    });
    for (const j of r.results) {
      const old = byId.get(j.id);
      if (!old || (!old.salary && j.salary)) byId.set(j.id, j);
    }
    for (const s of r.sources) {
      const cur = sources.get(s.name) || { name: s.name, ok: true, count: 0, note: '' };
      cur.ok = cur.ok && s.ok;
      cur.count += s.count || 0;
      cur.note = cur.note || s.note || '';
      sources.set(s.name, cur);
    }
    console.log(`${q}: ${r.results.length} roles`);
  }

  const jobs = [...byId.values()].sort((a, b) => new Date(b.posted || 0) - new Date(a.posted || 0));

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}

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
    jobs,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`${jobs.length} roles saved${same ? ' (unchanged)' : ''}.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
