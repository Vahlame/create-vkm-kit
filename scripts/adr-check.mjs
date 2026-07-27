#!/usr/bin/env node
/**
 * The ADR index must describe the ADRs that exist.
 *
 * `docs/adr/README.md` is a hand-maintained table over 78 files, and hand-maintained
 * tables drift in exactly two ways: a record lands without a row, or a row outlives its
 * file. Both are silent — the directory listing still looks complete — and the second is
 * worse, because `linkcheck` catches a broken link but not a row whose Status is stale.
 *
 * It also checks supersession is RECIPROCAL. ADR-0055 sat at a flat "Accepted" for
 * releases while ADR-0057, four days newer, declared in its own header that it superseded
 * two of its sections. A reader arriving at 0055 had no way to know.
 *
 * Pure Node built-ins, no deps, so it runs in CI before `npm ci`.
 *
 *   node scripts/adr-check.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADR_DIR = path.join(ROOT, "docs", "adr");

/** `0057-obscura-…md` -> "0057". */
const idOf = (file) => file.slice(0, 4);

const files = readdirSync(ADR_DIR)
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .sort();
const index = readFileSync(path.join(ADR_DIR, "README.md"), "utf8");

/** @type {string[]} */
const problems = [];

// 1. Every ADR file has a row linking to it.
for (const file of files) {
  if (!index.includes(`(./${file})`)) {
    problems.push(`ADR-${idOf(file)} has no row in docs/adr/README.md (file: ${file})`);
  }
}

// 2. Every row's target exists.
const known = new Set(files);
for (const m of index.matchAll(/\(\.\/(\d{4}-[^)]+\.md)\)/g)) {
  if (!known.has(m[1])) problems.push(`docs/adr/README.md links ./${m[1]}, which does not exist`);
}

// 3. Supersession is reciprocal: if A says it supersedes B, B must say so too.
//    Read from the ADR bodies, which is where the fact is stated.
for (const file of files) {
  const body = readFileSync(path.join(ADR_DIR, file), "utf8");
  const declares = body.match(/^-\s+\*\*Supersedes:\*\*\s*(.+)$/m);
  if (!declares) continue;
  for (const target of declares[1].matchAll(/ADR-(\d{4})/g)) {
    const other = files.find((f) => idOf(f) === target[1]);
    if (!other) {
      problems.push(`ADR-${idOf(file)} supersedes ADR-${target[1]}, which does not exist`);
      continue;
    }
    const otherBody = readFileSync(path.join(ADR_DIR, other), "utf8");
    if (!/superseded/i.test(otherBody)) {
      problems.push(
        `ADR-${idOf(file)} supersedes ADR-${target[1]}, but ADR-${target[1]} never says it was ` +
          `superseded — a reader landing there acts on a reversed decision`
      );
    }
  }
}

if (problems.length) {
  console.error(`adr-check: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`adr-check: OK (${files.length} ADRs, all indexed, supersession reciprocal)`);
