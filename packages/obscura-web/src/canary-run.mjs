#!/usr/bin/env node
/**
 * CLI runner for the SERP-parser canary (canary.mjs). Hits real search engines — run manually or
 * on a schedule, never from `npm test`.
 *
 * Usage:
 *   node src/canary-run.mjs                         # every registered engine
 *   node src/canary-run.mjs --engines duckduckgo,bing
 *   node src/canary-run.mjs --queries "rust ownership,typescript generics"
 *   node src/canary-run.mjs --json
 *
 * Exit code 1 if any probed engine came back `ok:false` — wire this into a scheduled job
 * (cron / Task Scheduler) to get alerted before an agent's real research call hits the same gap.
 */
import { runCanary, CANARY_QUERIES } from "./canary.mjs";

function parseArgs(argv) {
  const out = { engines: undefined, queries: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--engines") out.engines = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--queries") out.queries = argv[++i].split(",").map((s) => s.trim());
  }
  return out;
}

async function main() {
  const { engines, queries, json } = parseArgs(process.argv.slice(2));
  const results = await runCanary({ engines, queries: queries ?? CANARY_QUERIES });

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    const width = Math.max(...results.map((r) => r.engine.length), "ENGINE".length);
    console.log(`${"ENGINE".padEnd(width)}  OK     COUNT  DETAIL`);
    for (const r of results) {
      const detail = r.ok ? r.sampleTitle : r.error;
      console.log(
        `${r.engine.padEnd(width)}  ${r.ok ? " ✓ " : " ✗ "}   ${String(r.count).padEnd(5)}  ${detail}`
      );
    }
  }

  const broken = results.filter((r) => !r.ok);
  if (broken.length) {
    console.error(
      `\n${broken.length}/${results.length} engine(s) returned nothing: ${broken.map((r) => r.engine).join(", ")}`
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exitCode = 1;
});
