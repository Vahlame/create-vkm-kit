#!/usr/bin/env node
/**
 * Freeze SearXNG's JSON for every query in the golden set, so the research bench can gate CI
 * deterministically — no network, no engines, no drift.
 *
 * Why frozen fixtures and not a live bench: the web changes under you. A live run measures the
 * web *and* the ranker at once, so a red gate can't tell "our ranking regressed" from "Google
 * reshuffled". The fixtures pin the ranker; `--live` re-measures drift on purpose, on demand.
 *
 * Usage (from the repo root or this package):
 *   node src/bench-capture.mjs                # capture every query missing a fixture
 *   node src/bench-capture.mjs --force        # re-capture everything (refreshes the snapshot)
 *   node src/bench-capture.mjs --categories general,it,science
 *
 * Requires a local SearXNG (packages/obscura-web/searxng/README.md). It is started on demand
 * via the same `ensureSearxng` the MCP uses and stopped when this exits.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureSearxng, stopSearxng } from "./ensure-searxng.mjs";
import { loadQueries } from "./bench-research.mjs";

/** Pause between captures. Each query fans out to ~108 upstream engines; capturing the golden
 * set back-to-back is what suspended every engine on this machine during development. */
const CAPTURE_DELAY_MS = Number(process.env.OBSCURA_BENCH_CAPTURE_DELAY_MS) || 2000;

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/obscura-web/src/<this> -> repo root is three levels up.
export const REPO_ROOT = join(__dirname, "..", "..", "..");
export const EVALS_DIR = join(REPO_ROOT, "evals", "research");
export const QUERIES_PATH = join(EVALS_DIR, "queries.jsonl");
export const FIXTURES_DIR = join(EVALS_DIR, "fixtures");

/** Stable, filesystem-safe fixture name for a (query, categories) pair. Deterministic so a
 * re-capture overwrites its own snapshot instead of growing a second one. */
export function fixtureName(query, categories) {
  const q = String(query)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const cat = String(categories || "general").replace(/[^a-z0-9]+/gi, "-");
  return `${q}__${cat}.json`;
}

/** One SearXNG JSON search. Returns the parsed body verbatim — every field, including the
 * `score`/`positions`/`engines` the pipeline used to throw away. */
export async function searxngRaw(base, query, { categories = "general", pageno = 1 } = {}) {
  const url =
    `${base.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}` +
    `&format=json&pageno=${pageno}&categories=${encodeURIComponent(categories)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "X-Forwarded-For": "127.0.0.1" }
    });
    if (!res.ok) throw new Error(`searxng HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const catArg = args.indexOf("--categories");
  const categoriesList =
    catArg !== -1 && args[catArg + 1] ? args[catArg + 1].split(",") : ["general"];

  const queries = await loadQueries(QUERIES_PATH);
  await mkdir(FIXTURES_DIR, { recursive: true });
  const existing = new Set(await readdir(FIXTURES_DIR).catch(() => []));

  const base = await ensureSearxng();
  if (!base) {
    console.error(
      "SearXNG is not reachable and could not be started.\n" +
        "The bench fixtures need it once; see packages/obscura-web/searxng/README.md."
    );
    process.exitCode = 1;
    return;
  }
  console.error(`searxng up at ${base}`);

  let captured = 0;
  let skipped = 0;
  let aborted = null;
  try {
    for (const q of queries) {
      if (aborted) break;
      for (const categories of categoriesList) {
        const name = fixtureName(q.query, categories);
        if (!force && existing.has(name)) {
          skipped++;
          continue;
        }
        const body = await searxngRaw(base, q.query, { categories });
        const results = body.results ?? [];
        const unresponsive = body.unresponsive_engines ?? [];

        // REFUSE to write an empty fixture. A rate-limited SearXNG answers 200 with
        // `results: []`, so `--force` against a banned machine would silently overwrite every
        // good snapshot with an empty one and quietly destroy the bench — the numbers would
        // still compute, they would just all be zero, and it would look like a code regression.
        // Learned live: an afternoon of capture + probes suspended brave/google cse (180s),
        // startpage (CAPTCHA, 3600s) and wikidata, and the ban is upstream (Google/Brave against
        // this IP), so it outlives a SearXNG restart.
        if (!results.length) {
          const why = unresponsive.length
            ? `engines unavailable: ${unresponsive.map((e) => `${e[0]} (${e[1]})`).join(", ")}`
            : "SearXNG returned no results";
          console.error(`  SKIP ${name} — ${why}`);
          if (unresponsive.length) {
            aborted = why;
            break;
          }
          skipped++;
          continue;
        }
        // Snapshot metadata alongside the payload: a fixture with no provenance is a fixture
        // nobody can re-verify a year from now.
        const snapshot = {
          _captured: new Date().toISOString(),
          _query: q.query,
          _categories: categories,
          _n: results.length,
          results,
          unresponsive_engines: body.unresponsive_engines ?? []
        };
        await writeFile(join(FIXTURES_DIR, name), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
        captured++;
        const withScore = results.filter((r) => typeof r.score === "number").length;
        console.error(
          `  ${name}  n=${results.length}  with-score=${withScore}  ` +
            `unresponsive=${unresponsive.length}`
        );
        // Be a good neighbour: each query below fans out to ~108 upstream engines. Pacing the
        // capture is what keeps a full re-capture from banning the machine it runs on.
        await new Promise((r) => setTimeout(r, CAPTURE_DELAY_MS));
      }
    }
  } finally {
    stopSearxng();
  }
  console.error(`\ncaptured=${captured} skipped=${skipped} -> ${FIXTURES_DIR}`);
  if (aborted) {
    console.error(
      `\nABORTED — ${aborted}\n` +
        `Capturing against a rate-limited instance would write empty fixtures over good ones.\n` +
        `Existing fixtures were NOT touched. Wait out the suspension and re-run:\n` +
        `  searx/settings.yml suspended_times — 180s (too many requests), 3600s (CAPTCHA),\n` +
        `  1296000s (Cloudflare CAPTCHA). The upstream ban is against this IP, so it outlives a\n` +
        `  SearXNG restart — restarting will not clear it.`
    );
    process.exitCode = 1;
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("bench-capture.mjs")
) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
