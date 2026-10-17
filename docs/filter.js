// Client-side filtering of the saved job list. Also loaded by tests in Node.
(function (root) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);
  const REMOTE_AU = /^australia$|remote.*(australia|anz|apac)|(australia|anz|apac).*remote/;

  function filterJobs(jobs, f, now) {
    now = now || Date.now();
    const alts = (f.q || '').split(/\s+or\s+|,|\|/i).map((s) => s.trim()).filter(Boolean);
    const where = (f.where || '').toLowerCase().trim();
    const excl = (f.exclude || []).map((x) => new RegExp('\\b' + esc(x) + '\\b', 'i'));
    const cutoff = f.days ? now - f.days * 864e5 : 0;

    return jobs.filter((j) => {
      const title = (j.title || '').toLowerCase();
      if (alts.length && !alts.some((a) => words(a).every((w) => title.includes(w)))) return false;
      if (where) {
        const loc = (j.location || '').toLowerCase();
        if (!loc.includes(where) && !REMOTE_AU.test(loc)) return false;
      }
      if (f.industry && !(j.industries || []).includes(f.industry)) return false;
      if (excl.some((r) => r.test(j.title))) return false;
      if (cutoff && j.posted && new Date(j.posted).getTime() < cutoff) return false;
      if (f.salaryMin && j.salaryMin != null && j.salaryMin < f.salaryMin) return false;
      return true;
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { filterJobs };
  else root.filterJobs = filterJobs;
})(this);
