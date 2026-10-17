// Client-side filtering of the saved job list. Also loaded by tests in Node.
(function (root) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);
  const REMOTE_AU = /^australia$|remote.*(australia|anz|apac)|(australia|anz|apac).*remote/;
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => s.trim().toLowerCase()).filter(Boolean);

  function filterJobs(jobs, f, now) {
    now = now || Date.now();
    const alts = (f.q || '').split(/\s+or\s+|,|\|/i).map((s) => s.trim()).filter(Boolean);
    const where = (f.where || '').toLowerCase().trim();
    const excl = list(f.exclude).map((x) => new RegExp('\\b' + esc(x) + '\\b', 'i'));
    const company = (f.company || '').toLowerCase().trim();
    const exCompanies = list(f.excludeCompany);
    const cutoff = f.days ? now - f.days * 864e5 : 0;

    return jobs.filter((j) => {
      const title = (j.title || '').toLowerCase();
      const co = (j.company || '').toLowerCase();
      if (alts.length && !alts.some((a) => words(a).every((w) => title.includes(w)))) return false;
      if (where) {
        const loc = (j.location || '').toLowerCase();
        if (!loc.includes(where) && !REMOTE_AU.test(loc)) return false;
      }
      if (f.industry && !(j.industries || []).includes(f.industry)) return false;
      if (excl.some((r) => r.test(j.title || ''))) return false;
      if (cutoff && j.posted && new Date(j.posted).getTime() < cutoff) return false;
      if (f.salaryMin && j.salaryMin != null && j.salaryMin < f.salaryMin) return false;
      if (f.salaryOnly && !j.salary) return false;
      if (f.workplace === 'remote' && j.workplace !== 'remote') return false;
      if (f.workplace === 'remote-hybrid' && j.workplace !== 'remote' && j.workplace !== 'hybrid') return false;
      if (f.jobType && (j.jobType || 'unknown') !== f.jobType) return false;
      if (f.level && (j.level || 'mid') !== f.level) return false;
      if (f.category && (j.category || '') !== f.category) return false;
      if (f.size && (j.size || 'unknown') !== f.size) return false;
      if (f.source && j.source !== f.source) return false;
      if (company && !co.includes(company)) return false;
      if (exCompanies.length && exCompanies.some((x) => co.includes(x))) return false;
      if (f.hideAgencies && j.agency) return false;
      return true;
    });
  }

  function sortJobs(jobs, how) {
    const out = jobs.slice();
    if (how === 'salary') out.sort((a, b) => (b.salaryMin || 0) - (a.salaryMin || 0));
    else if (how === 'company') out.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
    else out.sort((a, b) => new Date(b.posted || 0) - new Date(a.posted || 0));
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { filterJobs, sortJobs };
  else { root.filterJobs = filterJobs; root.sortJobs = sortJobs; }
})(this);
