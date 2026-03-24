# Bar License Radar

Static dashboard for tracking new liquor-license leads in Minneapolis and St. Paul, enriched with public contact signals and a suggested follow-up message for each lead.

## What it does

- Pulls official St. Paul licensing-hearing records from public city pages.
- Pulls official Minneapolis Public Hearings records and filters for liquor-license style items.
- Uses Apify Google Search results to enrich each lead with public website/contact signals.
- Writes everything to static JSON so the dashboard can be hosted on GitHub Pages.
- Generates a suggested follow-up subject/body for each lead.
- Does **not** auto-send email.

## Source priority

- `1.` Minnesota AGE Public Data Access is the preferred statewide source for approved and issued liquor-license data.
- `2.` Minneapolis Public Hearings is the early-warning source for pending Minneapolis retail applications and hearings.
- `3.` St. Paul License Hearings is the early-warning source for pending St. Paul applications and hearing activity.

Right now the AGE portal presents an anti-bot challenge to headless automation, so this build automates Minneapolis and St. Paul first and shows a warning about the AGE gap in the dashboard metadata.

## Local use

1. Copy `.env.example` to `.env` and set `APIFY_TOKEN`.
2. Install dependencies:
   - `npm install`
3. Refresh the data:
   - `npm run refresh`
4. Preview the dashboard:
   - `npm run preview`
5. Open:
   - [http://localhost:8787](http://localhost:8787)

## Data truthfulness

The public city records consistently expose hearing/public-record dates. They do **not** always expose a clean raw submitted-on date. This dashboard therefore stores:

- `hearing_date`
- `first_public_record_date`
- `application_date` only when an exact filed date is actually found

That prevents the UI from quietly labeling a hearing date as the exact application date.

## GitHub deployment

This project is structured so it can live as its own repo and publish on GitHub Pages:

- `.github/workflows/refresh-and-deploy.yml` refreshes the JSON daily and deploys the static dashboard.
- Add `APIFY_TOKEN` as a GitHub Actions secret.
- If this folder stays inside a larger repo, move the workflow to the repo root and adjust the paths in the workflow.

## Notes

- Minneapolis uses Playwright because the official LIMS site is browser-gated and the Public Hearings page is rendered client-side.
- St. Paul is scraped directly from official `Calendar.aspx`, `MeetingDetail.aspx`, and `LegislationDetail.aspx` pages.
- Apify is used for public web enrichment, not as the source of truth for licensing events.
- Operational cadence based on current public source behavior:
- `AGE`: business days, midday and late afternoon.
- `Minneapolis`: every morning.
- `St. Paul`: every Monday and Thursday, plus the daily run if you prefer a simpler single schedule.
