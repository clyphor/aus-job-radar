# Aus Job Radar

Live job search across aggregators and company career pages for Australia. Every search queries the sources in real time (2 to 10 minute cache to stay polite).

## 1. Get free API keys (5 minutes)

- **Adzuna** (covers many Australian boards): https://developer.adzuna.com/ gives you an App ID and App Key.
- **Jooble** (more boards): https://jooble.org/api/about gives you an API key.

You can run with just one of them.

## 2. Run it

```bash
export ADZUNA_APP_ID=your_id
export ADZUNA_APP_KEY=your_key
export JOOBLE_KEY=your_key
node server.js
```

Open http://localhost:3000. Needs Node 18 or newer. No npm install required.

## 3. Add company career pages

Edit `companies.json`. Find the slug from the company's careers URL:

- `boards.greenhouse.io/SLUG` -> `"ats": "greenhouse"`
- `jobs.lever.co/SLUG` -> `"ats": "lever"`
- `jobs.ashbyhq.com/SLUG` -> `"ats": "ashby"`

The starter slugs are guesses. If a board is wrong, the app shows "boards unreachable" so you know to fix it.

## 4. Put it online (free)

Deploy the folder to Render, Railway or Fly.io as a Node web service. Start command: `node server.js`. Add the three keys as environment variables.

## Notes

- Seek, Indeed and LinkedIn block scraping, so the app links to pre-filled searches on them instead. Adzuna and Jooble already include many of the same listings.
- The industry filter matches on company name and description text, so treat it as a best guess.
