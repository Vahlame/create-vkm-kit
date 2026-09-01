#!/usr/bin/env node
/**
 * collect-answers.mjs — turn per-cell answer files into the answers.jsonl the shared
 * bench CLI grades. For external-subject flows where each subject wrote its solution
 * file directly (e.g. agents that read their prompt from disk and wrote the answer
 * back): `answers/<id>__<condition>__<replica>.mjs` → `answers-<model>.jsonl`.
 *
 * Usage:
 *   node evals/discipline-bench/collect-answers.mjs [model] [answersDir]
 *   (defaults: model=deepseek-v4-flash, answersDir=this bench's results/answers)
 *
 * Output goes next to the answers dir; safe to re-run (regenerates).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const model = process.argv[2] ?? "deepseek-v4-flash";
const answersDir = process.argv[3] ?? path.join(HERE, "results", "answers");
const out = path.join(path.dirname(answersDir), `answers-${model}.jsonl`);

const rows = [];
for (const f of readdirSync(answersDir)) {
  const m = f.match(/^(.+)__(discipline|stock)__(\d+)\.mjs$/);
  if (!m) continue;
  rows.push({
    id: m[1],
    condition: m[2],
    replica: Number(m[3]),
    model,
    answer: readFileSync(path.join(answersDir, f), "utf8")
  });
}
rows.sort((a, b) =>
  `${a.id}|${a.condition}|${a.replica}`.localeCompare(`${b.id}|${b.condition}|${b.replica}`)
);
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`wrote ${rows.length} rows to ${out}`);
