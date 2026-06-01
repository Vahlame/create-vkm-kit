#!/usr/bin/env node
// Flag drift between *.md and *.en.md sibling pairs.
// Counts headings, fenced code blocks, list items, and inline links;
// fails CI if any pair differs by more than PARITY_THRESHOLD per category.
//
// The threshold is intentionally generous on first introduction. Tighten
// over time (lower the env var or hardcode) as the docs converge.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const THRESHOLD = parseInt(process.env.PARITY_THRESHOLD || "5", 10);
const ROOT = process.cwd();

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "tmp", "evals"]);
// Path prefixes (relative, forward-slash) to skip entirely.
const IGNORE_PREFIXES = ["docs/legacy/", "docs/adr/"];

async function walk(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    const rel = path.relative(ROOT, fp).replace(/\\/g, "/");
    if (IGNORE_PREFIXES.some((p) => rel.startsWith(p))) continue;
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(fp, acc);
    } else if (entry.name.endsWith(".md") && !entry.name.endsWith(".en.md")) {
      acc.push(fp);
    }
  }
  return acc;
}

function metrics(text) {
  const lines = text.split(/\r?\n/);
  let headings = 0;
  let fences = 0;
  let lists = 0;
  let links = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      fences++;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,6}\s/.test(line)) headings++;
    if (/^\s*[-*+]\s/.test(line)) lists++;
    const matches = line.match(/\[[^\]]+\]\([^)]+\)/g);
    if (matches) links += matches.length;
  }
  return { headings, fences, lists, links };
}

async function fileExists(fp) {
  try {
    await stat(fp);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const esFiles = await walk(ROOT);
  const failures = [];
  let pairsChecked = 0;
  for (const es of esFiles) {
    const en = es.replace(/\.md$/, ".en.md");
    if (!(await fileExists(en))) continue;
    pairsChecked++;
    const esM = metrics(await readFile(es, "utf8"));
    const enM = metrics(await readFile(en, "utf8"));
    const diffs = [];
    for (const k of Object.keys(esM)) {
      const d = Math.abs(esM[k] - enM[k]);
      if (d > THRESHOLD) {
        diffs.push(`${k}: ES=${esM[k]} EN=${enM[k]} (Δ${d} > ${THRESHOLD})`);
      }
    }
    if (diffs.length) {
      failures.push(
        `${path.relative(ROOT, es)} ↔ ${path.relative(ROOT, en)}\n  ${diffs.join("\n  ")}`
      );
    }
  }
  console.log(
    `es-en parity: ${pairsChecked} pairs checked, ${failures.length} drifted (threshold=${THRESHOLD})`
  );
  if (failures.length) {
    console.error("\n" + failures.join("\n\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
