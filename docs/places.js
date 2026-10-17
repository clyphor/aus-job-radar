// Australian places used for location filters and distance. Shared by the page and the fetch script.
// Coordinates are approximate city or suburb centres.
(function (root) {
  const P = (name, lat, lon, state, metro) => ({ name, lat, lon, state, metro: metro || name });
  const PLACES = [
    P('Sydney', -33.87, 151.21, 'NSW'),
    P('Melbourne', -37.81, 144.96, 'VIC'),
    P('Brisbane', -27.47, 153.03, 'QLD'),
    P('Perth', -31.95, 115.86, 'WA'),
    P('Adelaide', -34.93, 138.6, 'SA'),
    P('Canberra', -35.28, 149.13, 'ACT'),
    P('Hobart', -42.88, 147.33, 'TAS'),
    P('Darwin', -12.46, 130.84, 'NT'),
    P('Gold Coast', -28.02, 153.4, 'QLD'),
    P('Newcastle', -32.93, 151.78, 'NSW'),
    P('Wollongong', -34.43, 150.89, 'NSW'),
    P('Geelong', -38.15, 144.36, 'VIC'),
    P('Sunshine Coast', -26.65, 153.07, 'QLD'),
    P('Central Coast', -33.43, 151.34, 'NSW'),
    P('Townsville', -19.26, 146.82, 'QLD'),
    P('Cairns', -16.92, 145.77, 'QLD'),
    P('Toowoomba', -27.56, 151.95, 'QLD'),
    P('Ballarat', -37.56, 143.85, 'VIC'),
    P('Bendigo', -36.76, 144.28, 'VIC'),
    P('Launceston', -41.44, 147.14, 'TAS'),
    P('Albury', -36.08, 146.92, 'NSW'),
    P('Wagga Wagga', -35.12, 147.37, 'NSW'),
    // suburbs and business districts, grouped under their city
    P('Parramatta', -33.82, 151.0, 'NSW', 'Sydney'),
    P('North Sydney', -33.84, 151.21, 'NSW', 'Sydney'),
    P('Chatswood', -33.8, 151.18, 'NSW', 'Sydney'),
    P('Macquarie Park', -33.78, 151.13, 'NSW', 'Sydney'),
    P('Surry Hills', -33.88, 151.21, 'NSW', 'Sydney'),
    P('Pyrmont', -33.87, 151.19, 'NSW', 'Sydney'),
    P('Barangaroo', -33.86, 151.2, 'NSW', 'Sydney'),
    P('Liverpool', -33.92, 150.92, 'NSW', 'Sydney'),
    P('Penrith', -33.75, 150.69, 'NSW', 'Sydney'),
    P('Blacktown', -33.77, 150.91, 'NSW', 'Sydney'),
    P('Bondi Junction', -33.89, 151.25, 'NSW', 'Sydney'),
    P('St Leonards', -33.82, 151.19, 'NSW', 'Sydney'),
    P('Docklands', -37.82, 144.95, 'VIC', 'Melbourne'),
    P('Southbank', -37.83, 144.96, 'VIC', 'Melbourne'),
    P('Fortitude Valley', -27.46, 153.04, 'QLD', 'Brisbane'),
  ];
  const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
  const STATE_NAMES = {
    'new south wales': 'NSW', nsw: 'NSW', victoria: 'VIC', vic: 'VIC', queensland: 'QLD', qld: 'QLD',
    'western australia': 'WA', wa: 'WA', 'south australia': 'SA', sa: 'SA', tasmania: 'TAS', tas: 'TAS',
    'australian capital territory': 'ACT', act: 'ACT', 'northern territory': 'NT', nt: 'NT',
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // longest names first so "North Sydney" wins over "Sydney"
  const byLength = PLACES.slice().sort((a, b) => b.name.length - a.name.length);
  const placeRes = byLength.map((p) => [p, new RegExp('\\b' + esc(p.name) + '\\b', 'i')]);
  const stateRe = new RegExp('\\b(' + Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length).map(esc).join('|') + ')\\b', 'i');

  function findPlace(text) {
    const t = String(text || '');
    for (const [p, re] of placeRes) if (re.test(t)) return p;
    return null;
  }
  function stateOf(text) {
    const m = String(text || '').match(stateRe);
    return m ? STATE_NAMES[m[1].toLowerCase()] : '';
  }
  function distanceKm(a, b) {
    const R = 6371, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const api = { PLACES, STATES, findPlace, stateOf, distanceKm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Places = api;
})(this);
