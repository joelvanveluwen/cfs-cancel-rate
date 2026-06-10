/**
 * One-command refresh for the dashboard data.
 *
 * Usage:
 *   npm run refresh-data
 *
 * Optional:
 *   BACKFILL_DAYS=7 npm run refresh-data
 *   npm run refresh-data -- --strict
 */
import { spawnSync } from "node:child_process";

const strict = process.argv.includes("--strict") || process.env.REFRESH_STRICT === "1";

function run(label, command, args, { required = true } = {}) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (result.status === 0) return true;

  const code = result.status ?? 1;
  if (required) process.exit(code);

  console.warn(`\nSkipped: ${label} did not complete. Existing data was left unchanged where the fetcher protects it.`);
  if (strict) process.exit(code);
  return false;
}

console.log("Refreshing Coffs Harbour flight cancellation data.");

run("Official monthly BITRE data", "npm", ["run", "fetch-data"]);
const recentOk = run("Recent flight-level disruption log", "npm", ["run", "fetch-recent"], { required: false });

console.log("\nRefresh complete.");
console.log("- data/cfs.json has the latest BITRE monthly route snapshot available from data.gov.au.");
console.log(
  recentOk
    ? "- data/recent.json was refreshed from the flight-level API."
    : "- data/recent.json was not refreshed. Check the AeroDataBox/RapidAPI/API.Market key or subscription, then rerun npm run fetch-recent."
);
console.log("\nTip: run npm run build after refreshing data if you want to verify the app before publishing.");
