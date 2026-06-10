/**
 * Pulls flight-level departures/arrivals for Coffs Harbour (CFS) from
 * AeroDataBox and appends cancelled or heavily delayed (60+ min) flights to
 * a rolling 14-day log in data/recent.json.
 *
 * Needs an AeroDataBox marketplace key:
 *   1. Subscribe at https://rapidapi.com/aerodatabox/api/aerodatabox
 *      or https://api.market/store/aedbx/aerodatabox
 *   2. Either AERODATABOX_KEY=<your key> npm run fetch-recent,
 *      or put AERODATABOX_KEY=<your key> in a .secrets file (gitignored)
 *      next to package.json.
 *
 * Each run covers yesterday + today; run daily (see .github/workflows) and
 * the log accumulates a full 14-day window.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function keyCandidatesFromSecretsFile() {
  const candidates = [];
  for (const p of [join(ROOT, ".secrets"), join(ROOT, "..", ".secrets")]) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf-8").trim();
    const bare = [];
    for (const line of text.split("\n")) {
      const value = line.trim();
      if (!value || value.startsWith("#")) continue;
      const m = value.match(/^(?:AERODATABOX_KEY|RAPIDAPI_KEY)\s*=\s*(.+)$/);
      if (m) candidates.push(m[1].trim());
      else if (!value.includes("=")) bare.push(value);
    }
    candidates.push(...bare);
  }
  return [...new Set(candidates)].filter(Boolean);
}

const KEY_CANDIDATES = [
  process.env.AERODATABOX_KEY,
  process.env.RAPIDAPI_KEY,
  ...keyCandidatesFromSecretsFile(),
].filter(Boolean);

if (KEY_CANDIDATES.length === 0) {
  console.error(
    "No key found. Set AERODATABOX_KEY or add AERODATABOX_KEY=<key> to .secrets " +
      "(free key: https://rapidapi.com/aerodatabox/api/aerodatabox)"
  );
  process.exit(1);
}
if (KEY_CANDIDATES.some((key) => key.startsWith("eyJ"))) {
  console.error(
    "The key found looks like a JWT (starts with 'eyJ') — that's not a RapidAPI key. " +
      "RapidAPI keys are ~50-character alphanumeric strings from rapidapi.com/aerodatabox."
  );
  process.exit(1);
}

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "recent.json");
const DELAY_THRESHOLD_MIN = 60;
const WINDOW_DAYS = 14;
const PROVIDERS = [
  {
    name: "RapidAPI",
    baseUrl: "https://aerodatabox.p.rapidapi.com",
    headers: (key) => ({ "X-RapidAPI-Key": key, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" }),
  },
  {
    name: "API.Market",
    baseUrl: "https://prod.api.market/api/v1/aedbx/aerodatabox",
    headers: (key) => ({ "x-magicapi-key": key }),
  },
];

const dayStr = (offset) => {
  const d = new Date(Date.now() + offset * 86400_000);
  return d.toISOString().slice(0, 10);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fids(from, to, attempt = 1) {
  let res;
  let lastAuthStatus = "";
  for (const provider of PROVIDERS) {
    const url =
      `${provider.baseUrl}/flights/airports/iata/CFS/${from}/${to}` +
      `?withLeg=true&withCancelled=true&withCodeshared=false&direction=Both&withLocation=false`;
    for (const key of KEY_CANDIDATES) {
      res = await fetch(url, { headers: provider.headers(key) });
      if (res.status !== 401 && res.status !== 403 && res.status !== 400) break;
      const text = await res.text();
      const apiMarketInvalidKey = provider.name === "API.Market" && /Invalid x-(api-market-key|magicapi-key)/i.test(text);
      if (res.status === 400 && !apiMarketInvalidKey) throw new Error(`${provider.name} ${res.status}: ${text}`);
      lastAuthStatus = `${provider.name} ${res.status}: ${text}`;
    }
    if (res.status !== 401 && res.status !== 403 && res.status !== 400) break;
  }
  if (res.status === 429 && attempt <= 3) {
    await sleep(2000 * attempt); // basic plan rate-limits per second
    return fids(from, to, attempt + 1);
  }
  if (res.status === 204) return { departures: [], arrivals: [] };
  if (!res.ok) throw new Error(lastAuthStatus || `AeroDataBox ${res.status}: ${await res.text()}`);
  return res.json();
}

const parseUtc = (s) => new Date(s.replace(" ", "T"));
const minutesLate = (side) => {
  const sched = side?.scheduledTime?.utc;
  const revised = side?.revisedTime?.utc ?? side?.runwayTime?.utc;
  if (!sched || !revised) return 0;
  return Math.round((parseUtc(revised) - parseUtc(sched)) / 60000);
};

function extract(list, kind) {
  const out = [];
  for (const f of list ?? []) {
    // each flight has departure/arrival sides; the CFS side carries no
    // airport field, and live delay times usually exist on the other end
    const cfsSide = kind === "departure" ? f.departure : f.arrival;
    const otherSide = kind === "departure" ? f.arrival : f.departure;
    const status = (f.status ?? "").toLowerCase();
    const delay = Math.max(minutesLate(cfsSide), minutesLate(otherSide));
    const cancelled = status.includes("cancel");
    if (!cancelled && delay < DELAY_THRESHOLD_MIN) continue;
    const schedLocal = cfsSide?.scheduledTime?.local ?? "";
    out.push({
      date: schedLocal.slice(0, 10) || dayStr(0),
      callsign: f.number?.replace(/\s+/g, "") ?? "?",
      airline: f.airline?.name ?? "Unknown",
      kind, // departure = leaving CFS, arrival = into CFS
      other_airport: otherSide?.airport?.iata ?? otherSide?.airport?.name ?? "?",
      scheduled_local: schedLocal.slice(11, 16),
      status: cancelled ? "cancelled" : "delayed",
      delay_min: cancelled ? null : delay,
      source: "AeroDataBox",
    });
  }
  return out;
}

// yesterday + today by default, in 12-hour windows (AeroDataBox max window).
// BACKFILL_DAYS=7 reaches further back for an initial fill.
const backfill = Math.min(7, Math.max(1, Number(process.env.BACKFILL_DAYS ?? 1)));
const windows = [];
for (let i = -backfill; i <= 0; i++) {
  const day = dayStr(i);
  windows.push([`${day}T00:00`, `${day}T11:59`], [`${day}T12:00`, `${day}T23:59`]);
}

const found = [];
let successfulWindows = 0;
for (const [from, to] of windows) {
  try {
    const data = await fids(from, to);
    successfulWindows++;
    found.push(...extract(data.departures, "departure"), ...extract(data.arrivals, "arrival"));
  } catch (e) {
    console.warn(`window ${from}: ${e.message}`);
  }
  await sleep(1500);
}

let existing = { flights: [] };
try {
  existing = JSON.parse(readFileSync(OUT, "utf-8"));
} catch {}

if (successfulWindows === 0) {
  console.error("No windows fetched successfully; keeping existing disruption log unchanged.");
  process.exit(1);
}

const cutoff = dayStr(-WINDOW_DAYS);
const seen = new Set();
const merged = [...found, ...existing.flights]
  .filter((f) => f.date >= cutoff)
  .filter((f) => {
    const k = `${f.date}|${f.callsign}|${f.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  })
  .sort((a, b) => `${b.date}${b.scheduled_local}`.localeCompare(`${a.date}${a.scheduled_local}`));

writeFileSync(OUT, JSON.stringify({ fetched_at: new Date().toISOString(), window_days: WINDOW_DAYS, flights: merged }, null, 1));
console.log(`Found ${found.length} disruptions in this run; log now has ${merged.length} entries (last ${WINDOW_DAYS} days)`);
