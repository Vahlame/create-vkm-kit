#!/usr/bin/env node
/**
 * Freeze real page text for the curator bake-off's golden set (`evals/research/curation.jsonl`),
 * so `bench-curate-run.mjs` measures curator MODELS against a fixed, reproducible input — not a
 * live page that can change under the bench between runs. Mirrors `bench-capture.mjs`'s reasoning
 * for the ranking bench, applied one stage later in the pipeline.
 *
 * Fetches HTML and runs it through `stripHiddenContent` (`sanitize.mjs`) — the SAME transform
 * `deepResearch` applies before a page ever reaches `curatePage` — so the fixture text is exactly
 * what curation sees in production, not a different shape (e.g. obscura's own markdown dump).
 *
 * Usage:
 *   node src/bench-curate-capture.mjs           # capture every url missing a fixture
 *   node src/bench-curate-capture.mjs --force   # re-capture everything
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { obscuraFetch } from "./obscura-cli.mjs";
import { stripHiddenContent } from "./sanitize.mjs";
import { hash8 } from "./url-identity.mjs";
import { EVALS_DIR } from "./bench-capture.mjs";

export const CURATION_QUERIES_PATH = join(EVALS_DIR, "curation.jsonl");
export const CURATION_FIXTURES_DIR = join(EVALS_DIR, "curation-fixtures");

/** Read the curator golden set: `{query, url, label, note?}` per line, `#`-comments and blank
 * lines skipped. One entry per (query, url) pair — the same url may repeat under a different
 * query (see curation.jsonl's vocab-mismatch pair), so capture is deduped by url, not by line. */
export async function loadCurationSet(path = CURATION_QUERIES_PATH) {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(path, "utf8");
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      throw new Error(`bench-curate: malformed line: ${line} (${err.message})`, { cause: err });
    }
    if (!obj.query || !obj.url || !["relevant", "irrelevant"].includes(obj.label)) {
      throw new Error(`bench-curate: line missing query/url/label(relevant|irrelevant): ${line}`);
    }
    out.push(obj);
  }
  if (!out.length) throw new Error(`bench-curate: no entries in ${path}`);
  return out;
}

export function fixturePath(url, dir = CURATION_FIXTURES_DIR) {
  return join(dir, `${hash8(url)}.txt`);
}

async function main() {
  const force = process.argv.includes("--force");
  const entries = await loadCurationSet();
  const uniqueUrls = [...new Set(entries.map((e) => e.url))];

  await mkdir(CURATION_FIXTURES_DIR, { recursive: true });
  const existing = new Set(await readdir(CURATION_FIXTURES_DIR).catch(() => []));

  let captured = 0;
  let skipped = 0;
  let failed = 0;
  for (const url of uniqueUrls) {
    const name = `${hash8(url)}.txt`;
    if (!force && existing.has(name)) {
      skipped++;
      continue;
    }
    try {
      const { content: html } = await obscuraFetch(url, { format: "html" });
      const text = stripHiddenContent(html);
      if (!text || text.length < 50) {
        throw new Error(`suspiciously short (${text.length} chars) — page may not have rendered`);
      }
      await writeFile(join(CURATION_FIXTURES_DIR, name), text, "utf8");
      console.error(`  captured ${name}  (${text.length} chars)  <- ${url}`);
      captured++;
    } catch (err) {
      console.error(`  FAILED ${url}: ${err.message}`);
      failed++;
    }
  }
  console.error(
    `\ncaptured=${captured} skipped=${skipped} failed=${failed} -> ${CURATION_FIXTURES_DIR}`
  );
  if (failed) process.exitCode = 1;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && join(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
