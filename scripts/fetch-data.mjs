/**
 * Downloads BITRE's Domestic Airlines On Time Performance time series
 * (real, official data — data.gov.au, CC-BY) and extracts:
 *   - all Coffs Harbour route rows (route, direction, airline, monthly)
 *   - Port Macquarie-Sydney and Ballina-Sydney comparison routes
 *   - the national "All Ports / All Airlines" benchmark
 * Writes data/cfs.json. Re-run monthly when BITRE publishes (~3rd week).
 *
 * Usage: npm run fetch-data
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CSV_URL =
  "https://data.gov.au/data/dataset/29128ebd-dbaa-4ff5-8b86-d9f30de56452/resource/cf663ed1-0c5e-497f-aea9-e74bfda9cf44/download/otp_time_series_web.csv";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(OUT, { recursive: true });

console.log("Downloading BITRE OTP time series…");
const res = await fetch(CSV_URL);
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const csv = await res.text();

const [header, ...lines] = csv.trim().split("\n");
const cols = header.trim().split(",");
const idx = Object.fromEntries(cols.map((c, i) => [c.trim(), i]));

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const COMPARE = {
  "Port Macquarie-Sydney": "pqq",
  "Sydney-Port Macquarie": "pqq",
  "Ballina-Sydney": "bnk",
  "Sydney-Ballina": "bnk",
};

const cfs = [];
const national = [];
const compare = { pqq: [], bnk: [] };
for (const line of lines) {
  const f = line.split(",");
  const route = f[idx.Route];
  const isCfs = route === "Coffs Harbour-Sydney" || route === "Sydney-Coffs Harbour";
  const isNational = route === "All Ports-All Ports" && f[idx.Airline] === "All Airlines";
  const compareKey = COMPARE[route] && f[idx.Airline] === "All Airlines" ? COMPARE[route] : null;
  if (!isCfs && !isNational && !compareKey) continue;

  const month = `${f[idx.Year]}-${String(f[idx.Month_Num]).trim().padStart(2, "0")}`;
  const row = {
    month,
    scheduled: num(f[idx.Sectors_Scheduled]),
    flown: num(f[idx.Sectors_Flown]),
    cancelled: num(f[idx.Cancellations]),
    dep_on_time: num(f[idx.Departures_On_Time]),
  };
  if (row.scheduled === null) continue; // BITRE masks some small counts

  if (isNational) national.push(row);
  else if (compareKey) compare[compareKey].push(row);
  else
    cfs.push({
      ...row,
      airline: f[idx.Airline],
      // "Sydney-Coffs Harbour" = flights INTO Coffs
      direction: route === "Sydney-Coffs Harbour" ? "arrivals" : "departures",
    });
}

const sortByMonth = (a, b) => a.month.localeCompare(b.month);
cfs.sort(sortByMonth);
national.sort(sortByMonth);
compare.pqq.sort(sortByMonth);
compare.bnk.sort(sortByMonth);

writeFileSync(
  join(OUT, "cfs.json"),
  JSON.stringify(
    {
      source: "BITRE Domestic Airlines On Time Performance (data.gov.au, CC-BY 3.0 AU)",
      source_url: "https://data.gov.au/data/dataset/domestic-airline-on-time-performance",
      fetched_at: new Date().toISOString().slice(0, 10),
      latest_month: cfs[cfs.length - 1]?.month,
      cfs,
      national,
      compare,
    },
    null,
    1
  )
);
console.log(`Wrote ${cfs.length} Coffs rows + ${national.length} national rows, through ${cfs[cfs.length - 1]?.month}`);
