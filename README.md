# Aus Job Radar

Job search across aggregators and company career pages for Australia.

There are two ways to run it. Both share the same code.

## A. GitHub only (default, free)

A GitHub Action runs every 4 hours, collects jobs for the roles in `searches.json`, and saves them to `docs/jobs.json`. A GitHub Pages site (`docs/index.html`) loads that file and filters it instantly in your browser.

### Setup (about 10 minutes)

1. **Get free API keys.** Adzuna: https://developer.adzuna.com/ (App ID and App Key). Jooble: https://jooble.org/api/about (API key). One of them is enough.
2. **Add them as secrets.** Repo Settings -> Secrets and variables -> Actions -> New repository secret. Names: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_KEY`.
3. **Turn on Pages.** Settings -> Pages -> Build and deployment -> Deploy from a branch -> `main` and `/docs` -> Save.
4. **Fill the list.** Actions tab -> Refresh jobs -> Run workflow. It takes about a minute.
5. **Open the site** at `https://<your-username>.github.io/aus-job-radar/`.

### What gets collected

Each run collects two things:

1. **Role keywords** from `searches.json` (customer success, support and so on) from Adzuna, Jooble and your company career pages.
2. **Adzuna job categories** (Accounting, IT, Sales, Legal, Healthcare and the rest of Adzuna's list). A few categories are refreshed per run on a rotation, newest roles first, so the Adzuna free call limit is not used up. The first time, run **Refresh jobs** from the Actions tab and tick **Fetch every Adzuna category now** to fill the whole list at once.

With every filter cleared the page lists every job collected from all sources; filters only narrow that list. The chips at the top show, per source, how many jobs were fetched and how many remain after removing duplicates. To stop one advertiser (for example a delivery company) flooding the list, `maxPerCompany` in `searches.json` keeps only that company's newest ads per job board (set it to 0 for no limit).

The page shows what was collected, not every job on every board. Seek, Indeed and LinkedIn cannot be collected at all.

### Filters on the page

Dropdowns with checkboxes (tick several, with a search box inside): role titles, location (states and cities), industry, job category, job type, work style, level, company size and source. Also role search words, distance from a city or your current location (5 to 200 km), posted date, company name, companies to leave out, titles to leave out, minimum salary, only roles with a salary, and hide recruiters. Sorting is by newest, salary or company.

- **Job category** is Adzuna's list of job functions, similar to Seek's classifications.
- **Industry** is a best guess from the company name and job category. Fix or add companies in `companyInfo.json`.
- **Remote, job type and level** are worked out from the title and description, so treat them as best guesses.
- **Company size** comes from `companyInfo.json` (approximate bands for well-known employers). Job APIs do not provide it.
- **Distance** uses each job's map coordinates from Adzuna, or the centre of its city. Roles with no location are kept unless you untick "Include roles with no specific location".

### Change what it collects

- `searches.json` lists the role keywords it collects (for example "customer success"), how many result pages to fetch per keyword, and how many Adzuna categories to refresh per run. The page can only filter jobs that were collected, so add a keyword here to search for a new kind of role. More keywords and pages mean more jobs but more Adzuna calls.
- `companies.json` lists company career boards. Find the slug in the careers URL:
  - `boards.greenhouse.io/SLUG` -> `"ats": "greenhouse"`
  - `jobs.lever.co/SLUG` -> `"ats": "lever"`
  - `jobs.ashbyhq.com/SLUG` -> `"ats": "ashby"`

Saving either file triggers a refresh. The starter slugs are guesses. The status chips at the top of the page show when a board can't be reached.

### Limits

- The list is up to 4 hours old, not live. Each run makes roughly 30 Adzuna calls. I could not confirm Adzuna's free call limit, so the schedule is cautious. If the status chips show Adzuna failing with a rate-limit error, run less often. Change the `cron` line in `.github/workflows/refresh-jobs.yml` to run more or less often.
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
