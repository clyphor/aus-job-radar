// Client-side filtering of the saved job list. Also loaded by tests in Node.
(function (root) {
  const Places = typeof module !== 'undefined' && module.exports ? require('./places.js') : root.Places;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const arr = (v) => (Array.isArray(v) ? v : []);

  // f: q, titles[], locations[], includeNoLocation, origin{lat,lon}, radius (km), industries[], categories[],
  //    jobTypes[], levels[], workplaces[], sizes[], sources[], company, excludeCompany, exclude, days,
  //    salaryMin, salaryOnly, hideAgencies
  function filterJobs(jobs, f, now) {
    now = now || Date.now();
    const alts = (f.q || '').split(/\s+or\s+|,|\|/i).map((s) => s.trim()).filter(Boolean);
    const excl = list(f.exclude).map((x) => new RegExp('\\b' + esc(x) + '\\b', 'i'));
    const company = (f.company || '').toLowerCase().trim();
    const exCompanies = list(f.excludeCompany);
    const cutoff = f.days ? now - f.days * 864e5 : 0;
    const titles = new Set(arr(f.titles).map((t) => t.toLowerCase()));
    const locs = new Set(arr(f.locations));
    const inds = new Set(arr(f.industries));
    const cats = new Set(arr(f.categories));
    const types = new Set(arr(f.jobTypes));
    const levels = new Set(arr(f.levels));
    const wps = new Set(arr(f.workplaces));
    const sizes = new Set(arr(f.sizes));
    const srcs = new Set(arr(f.sources));
    const keepNoLoc = f.includeNoLocation !== false;
    const useDistance = !!(f.radius && f.origin);

    return jobs.filter((j) => {
      const title = (j.title || '').toLowerCase();
      const co = (j.company || '').toLowerCase();
      if (alts.length && !alts.some((a) => words(a).every((w) => title.includes(w)))) return false;
      if (titles.size && !titles.has(title.trim())) return false;

      if (locs.size) {
        if (j.state || j.metro) {
          if (!locs.has(j.state) && !locs.has(j.metro)) return false;
        } else if (!keepNoLoc) return false;
      }
      if (useDistance) {
        if (j.lat == null || j.lon == null) { if (!keepNoLoc) return false; }
        else if (Places.distanceKm(f.origin, { lat: j.lat, lon: j.lon }) > f.radius) return false;
      }

      if (inds.size) {
        const tags = j.industries || [];
        const hit = tags.some((t) => inds.has(t)) || (inds.has('none') && !tags.length);
        if (!hit) return false;
      }
      if (cats.size && !cats.has(j.category || '')) return false;
      if (types.size && !types.has(j.jobType || 'unknown')) return false;
      if (levels.size && !levels.has(j.level || 'mid')) return false;
      if (wps.size && !wps.has(j.workplace || 'unknown')) return false;
      if (sizes.size && !sizes.has(j.size || 'unknown')) return false;
      if (srcs.size && !srcs.has(j.source)) return false;

      if (excl.some((r) => r.test(j.title || ''))) return false;
      if (cutoff && j.posted && new Date(j.posted).getTime() < cutoff) return false;
      if (f.salaryMin && j.salaryMin != null && j.salaryMin < f.salaryMin) return false;
      if (f.salaryOnly && !j.salary) return false;
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
