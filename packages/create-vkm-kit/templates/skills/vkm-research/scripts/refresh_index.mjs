#!/usr/bin/env node
/**
 * Rebuild RESEARCH/_index.md from what is actually on disk — a full rescan, not an incremental
 * patch. research-persist.mjs's own updateGlobalIndex only runs from inside persistResults /
 * consolidateTopic (JS pipeline calls); a topic last touched by THIS skill (/vkm-research writes
 * summary.md's frontmatter directly, never calling back into that JS) drifts the global table out
 * of sync with reality — confirmed live: 5 of 10 topics showed "Summary: no" while their
 * summary.md was already `status: consolidated`, and one topic was missing a row entirely. A full
 * rescan is idempotent and self-healing, so that class of drift cannot recur. Safe to run any time.
 *
 *   node refresh_index.mjs [research-dir]   # defaults to $OBSCURA_RESEARCH_DIR
 */
import { readdir, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.env.OBSCURA_RESEARCH_DIR || "");
if (!root) {
  console.error("usage: refresh_index.mjs <research-dir>  (or set OBSCURA_RESEARCH_DIR)");
  process.exit(1);
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const entries = await readdir(root, { withFileTypes: true });
const topics = entries
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const rows = [];
for (const topic of topics) {
  const dir = path.join(root, topic);
  let sourceCount = 0;
  try {
    sourceCount = (await readdir(path.join(dir, "sources"))).filter((f) =>
      f.endsWith(".md")
    ).length;
  } catch {
    /* no sources/ yet */
  }
  const hasSummary = await exists(path.join(dir, "summary.md"));
  const hasCompiled = await exists(path.join(dir, "compiled-sources.md"));
  // The per-topic hub is rewritten atomically on every pipeline touch (persistResults) — its
  // mtime is a faithful "last run" signal without needing to parse the Queries log.
  let lastRun = "";
  try {
    lastRun = (await stat(path.join(dir, "_index.md"))).mtime.toISOString();
  } catch {
    /* no hub — e.g. an imported-only topic that never went through obscura_research */
  }
  rows.push(
    `| ${topic} | ${sourceCount} | ${lastRun} | ${hasSummary ? "yes" : "no"} | ` +
      `${hasCompiled ? "yes" : "no"} |`
  );
}

const header =
  "# Research index\n\n| Topic | Sources | Last run | Summary | Compiled |\n|---|---|---|---|---|\n";
const fp = path.join(root, "_index.md");
const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
await writeFile(tmp, header + rows.join("\n") + "\n", "utf8");
await rename(tmp, fp);
console.log(`refreshed ${fp} — ${topics.length} topics`);
