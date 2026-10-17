# Aus Job Radar

Job search across aggregators and company career pages for Australia.

There are two ways to run it. Both share the same code.

## A. GitHub only (default, free)

A GitHub Action runs every hour, collects jobs for the roles in `searches.json`, and saves them to `docs/jobs.json`. A GitHub Pages site (`docs/index.html`) loads that file and filters it instantly in your browser.

### Setup (about 10 minutes)

1. **Get free API keys.** Adzuna: https://developer.adzuna.com/ (App ID and App Key). Jooble: https://jooble.org/api/about (API key). One of them is enough.
2. **Add them as secrets.** Repo Settings -> Secrets and variables -> Actions -> New repository secret. Names: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_KEY`.
3. **Turn on Pages.** Settings -> Pages -> Build and deployment -> Deploy from a branch -> `main` and `/docs` -> Save.
4. **Fill the list.** Actions tab -> Refresh jobs -> Run workflow. It takes about a minute.
5. **Open the site** at `https://<your-username>.github.io/aus-job-radar/`.

### Change what it collects

- `searches.json` lists the role keywords it collects (for example "customer success"). The page can only filter jobs that were collected, so add a keyword here to search for a new kind of role.
- `companies.json` lists company career boards. Find the slug in the careers URL:
  - `boards.greenhouse.io/SLUG` -> `"ats": "greenhouse"`
  - `jobs.lever.co/SLUG` -> `"ats": "lever"`
  - `jobs.ashbyhq.com/SLUG` -> `"ats": "ashby"`

Saving either file triggers a refresh. The starter slugs are guesses. The status chips at the top of the page show when a board can't be reached.

### Limits

- The list is up to an hour old, not live.
- A free Pages site from a public repo is public, so anyone with the link can see the job list. Your keys stay hidden.
- GitHub may pause scheduled runs after about 60 days with no repo activity. Run the workflow by hand to restart it.

## B. Live server (Render or your own computer)

`server.js` runs the same search live on every request, so any new search works instantly.

```bash
export ADZUNA_APP_ID=your_id ADZUNA_APP_KEY=your_key JOOBLE_KEY=your_key
node server.js
```

Open http://localhost:3000. Needs Node 18 or newer, no `npm install`.

To host it, create a Render Blueprint from this repo. It reads `render.yaml` and asks for the three keys. The free plan sleeps when idle, so the first load is slow.

## Notes

- Seek, Indeed and LinkedIn block scraping, so the app links to pre-filled searches on them. Adzuna and Jooble already include many of the same listings.
- The industry filter matches company names and description text, so treat it as a best guess.
- Workday employers (IAG, Suncorp and similar) are not covered yet.
