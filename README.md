# Coffs Harbour Flight Cancellations

One-page dashboard of cancellations on the Coffs Harbour ↔ Sydney route, built on **real official data**:
BITRE's [Domestic Airlines On Time Performance](https://data.gov.au/data/dataset/domestic-airline-on-time-performance)
series (monthly, by airline and direction, back to 2004, CC-BY 3.0 AU).

```bash
npm install
npm run fetch-data   # pull the latest BITRE CSV → data/cfs.json
npm run refresh-data # refresh BITRE data and the recent disruption log
npm run dev          # http://localhost:3000
npx vercel           # deploy
```

BITRE publishes around the third week of each month (~7-week lag). Re-run `npm run fetch-data` and redeploy —
or automate it with a monthly GitHub Action / Vercel cron.

## What the data covers

- Scheduled sectors, cancellations, on-time departures/arrivals for Coffs Harbour–Sydney, per airline, per direction
- A national all-routes benchmark plus Port Macquarie–Sydney and Ballina–Sydney comparison routes
  (toggle on the trend chart)

## Flight-level disruption log (last 14 days)

BITRE can't provide recent specific flights (monthly, ~7-week lag), and keyless live sources
(FlightRadar24, the airport flight boards) block automated access. The log uses
[AeroDataBox](https://rapidapi.com/aerodatabox/api/aerodatabox) instead — free Basic plan is enough:

```bash
echo "AERODATABOX_KEY=<rapidapi key>" > .secrets   # gitignored; env var also works
npm run fetch-recent
```

Each run captures yesterday + today's cancellations and 60+ minute delays (call sign, route, scheduled
time) into `data/recent.json`, keeping a rolling 14-day window. Add `AERODATABOX_KEY` as a GitHub Actions
secret and `.github/workflows/update-data.yml` runs it daily (plus the BITRE refresh monthly).

## What it doesn't cover (and where to source it)

| Gap | Source |
|---|---|
| Cancellation reasons | No official source — airline status pages, FlightAware AeroAPI / Cirium / OAG (paid), or airport/council ops logs |
| Coffs–Brisbane / Coffs–Melbourne | Not BITRE-monitored — flight-level APIs or the airport arrivals board |
| Seats / load factors | BITRE Domestic Aviation Activity (monthly) |
| Weather context | BOM daily observations, Coffs Harbour Airport station 059151 |

## Stack

Next.js (App Router) on Vercel, Tailwind CSS v4, no database — the dataset is a 300 KB JSON snapshot
committed to the repo and read at build time. Single server-rendered page, hand-rolled SVG chart.
