#!/usr/bin/env node
/**
 * The one CLI every live-LLM bench runs on.
 *
 * Six `run.mjs` files each carried their own copy of the same three modes
 * (`--emit-prompts` / `--grade` / `--models`), the same `get(flag)` argv scanner and the
 * same triple `for` loop. The copies had already drifted: one printed its report on
 * stdout and its rows on stderr while five did the reverse, one ordered its conditions
 * baseline-first so its delta came out with the opposite sign to every other bench, and
 * every one of them destructured `{ answer, cost }` and then reported only the answer.
 *
 * Two things this fixes beyond the duplication:
 *
 * 1. **`stats.mjs` is finally wired in.** ADR-0064 describes it as "shared by every bench
 *    runner"; it had zero production importers, so `MIN_N`, the bootstrap CI and the
 *    bold-only-when-earned rule existed as a library nothing called. Every report below
 *    goes through `classify()`, which means a bench cannot print a bold delta off n=2
 *    even if its author wants to.
 * 2. **Cost reaches the report.** `runSubject` has always returned per-run token counts
 *    (ADR-0065) and every caller dropped them. A cell now prints what it spent next to
 *    what it scored, and the delta line carries quality-per-1k-tokens.
 *
 * Stream contract, uniform across benches: **stdout is JSONL rows** (machine-readable,
 * one object per answer), **stderr is the human report**. So `run.mjs --grade a.jsonl >
 * rows.jsonl` works the same way everywhere and you still see the summary.
 *
 * Zero deps.
 */
import { readFileSync } from "node:fs";
import { classify, formatCell, formatDelta } from "./stats.mjs";
import { aggregateCost, costEfficiency, formatCost, runSubject } from "./subject-runner.mjs";

/** Read `--flag value` out of an argv array. */
export const flag = (argv, name) =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;

/**
 * @typedef {object} BenchCase
 * @property {string} id
 */

/**
 * Generic in the case type, because every bench carries its own extra fields on a case
 * (`idea`, `brief`, `fixture`) and `subjectPrompt`/`grade` need to see them. Without the
 * parameter, `strictFunctionTypes` rejects each bench's narrower handler against a
 * `BenchCase`-typed slot — correctly, since the driver would be free to pass a bare
 * `{id}`. It never does: it only ever passes back cases it was given.
 *
 * @template {BenchCase} C
 * @typedef {object} BenchSpec
 * @property {string} name                       bench name, printed in the report header
 * @property {C[]} cases                         the task/brief/topic list
 * @property {[string, string]} conditions       [treatment, baseline] — treatment FIRST, so
 *                                               a positive delta always means "the thing
 *                                               under test helped", in every bench
 * @property {(c: C, condition: string) => string} subjectPrompt
 * @property {(c: C, answer: string, meta: {model: string, condition: string, replica: number}) => number|Promise<number>} grade
 * @property {number} [defaultN]                 replicas per cell when `--n` is absent
 * @property {number} [epsilon]                  pre-registered indifference margin
 */

/**
 * Fan out cases × conditions × replicas. One place, so the three modes below cannot
 * disagree about what a run consists of.
 * @template {BenchCase} C
 * @param {C[]} cases
 * @param {readonly string[]} conditions
 * @param {number} n
 */
function* cells(cases, conditions, n) {
  for (const c of cases)
    for (const condition of conditions)
      for (let replica = 1; replica <= n; replica++) yield { c, condition, replica };
}

/**
 * Group scored rows into `${model}|${condition}` cells.
 * @param {Array<{model?: string, condition: string, score: number, cost?: object}>} rows
 */
function bucket(rows) {
  /** @type {Map<string, {scores: number[], costs: object[]}>} */
  const cellMap = new Map();
  for (const r of rows) {
    const key = `${r.model ?? "?"}|${r.condition}`;
    if (!cellMap.has(key)) cellMap.set(key, { scores: [], costs: [] });
    const cell = cellMap.get(key);
    cell.scores.push(r.score);
    if (r.cost) cell.costs.push(r.cost);
  }
  return cellMap;
}

/**
 * The report. Per model: one line per condition (mean, spread, n, cost) and one delta
 * line whose emphasis `stats.classify()` decides.
 *
 * Returned as a string rather than printed so a test can assert on it without capturing
 * a stream — the reporting rule is the thing worth testing, and it was previously
 * untestable because it lived inline in six `main()` functions.
 *
 * @template {BenchCase} C
 * @param {BenchSpec<C>} spec
 * @param {Array<{model?: string, condition: string, score: number, cost?: object}>} rows
 * @returns {string}
 */
export function report(spec, rows) {
  const [treatment, baseline] = spec.conditions;
  const cellMap = bucket(rows);
  const models = [...new Set(rows.map((r) => r.model ?? "?"))];
  const lines = [`${spec.name} — ${rows.length} answers, ${models.length} model(s)`];

  for (const model of models) {
    lines.push(`  ${model}`);
    /** @type {Record<string, {scores: number[], costs: object[]}>} */
    const arms = {};
    for (const condition of spec.conditions) {
      const cell = cellMap.get(`${model}|${condition}`) ?? { scores: [], costs: [] };
      arms[condition] = cell;
      const cost = cell.costs.length ? ` · ${formatCost(aggregateCost(cell.costs))}` : "";
      lines.push(`    ${condition.padEnd(12)} ${formatCell(cell.scores)}${cost}`);
    }
    const a = arms[treatment].scores;
    const b = arms[baseline].scores;
    if (!a.length || !b.length) {
      lines.push(`    Δ(${treatment}−${baseline}) — (a cell is empty)`);
      continue;
    }
    const verdict = classify(a, b, { epsilon: spec.epsilon ?? 0 });
    let line = `    Δ(${treatment}−${baseline}) ${formatDelta(verdict)} · cliffs=${verdict.cliffs.toFixed(2)} (${verdict.magnitude})`;
    // Δquality against Δtokens (ADR-0065): winning while spending twice the tokens is a
    // different result from winning for free, and the report has to be able to say which.
    if (arms[treatment].costs.length && arms[baseline].costs.length) {
      const eff = costEfficiency(
        { quality: verdict.delta, cost: aggregateCost(arms[treatment].costs) },
        { quality: 0, cost: aggregateCost(arms[baseline].costs) }
      );
      if (eff.tokenDelta !== null) {
        line += ` · Δtok=${Math.round(eff.tokenDelta)}`;
        if (eff.qualityPerKToken !== null)
          line += ` · ${eff.qualityPerKToken.toFixed(2)} pts/1k tok`;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** Parse a JSONL file into objects, ignoring blank lines. */
export function readJsonl(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/**
 * Run one bench's CLI. Returns the process exit code rather than calling
 * `process.exit`, so it is callable from a test.
 *
 * @template {BenchCase} C
 * @param {BenchSpec<C>} spec
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function runBenchCli(spec, argv = process.argv.slice(2)) {
  const { cases, conditions } = spec;
  /** @type {Map<string, C>} */
  const byId = new Map(cases.map((c) => [c.id, c]));
  const n = Number(flag(argv, "--n") ?? spec.defaultN ?? 3);

  if (argv.includes("--emit-prompts")) {
    for (const { c, condition, replica } of cells(cases, conditions, n))
      console.log(
        JSON.stringify({ id: c.id, condition, replica, prompt: spec.subjectPrompt(c, condition) })
      );
    return 0;
  }

  const gradeFile = flag(argv, "--grade");
  if (gradeFile !== undefined) {
    const rows = [];
    for (const a of readJsonl(gradeFile)) {
      const c = byId.get(a.id);
      if (!c) {
        console.error(`  skipped: no case with id ${JSON.stringify(a.id)}`);
        continue;
      }
      const meta = { model: a.model ?? "x", condition: a.condition, replica: a.replica ?? 1 };
      const score = await spec.grade(c, a.answer, meta);
      const row = {
        id: a.id,
        condition: a.condition,
        replica: meta.replica,
        model: a.model,
        score
      };
      if (a.cost) row.cost = a.cost;
      rows.push(row);
      console.log(JSON.stringify(row));
    }
    console.error(report(spec, rows));
    return 0;
  }

  const models = flag(argv, "--models");
  if (models !== undefined) {
    const agentCmdBase = flag(argv, "--agent-cmd") ?? "claude -p --output-format json --model";
    const promptVia = /** @type {"argv"|"stdin"} */ (flag(argv, "--prompt-via") ?? "argv");
    const rows = [];
    for (const model of models.split(",")) {
      for (const { c, condition, replica } of cells(cases, conditions, n)) {
        const { answer, cost } = await runSubject({
          prompt: spec.subjectPrompt(c, condition),
          agentCmd: `${agentCmdBase} ${model}`,
          promptVia
        });
        const score = await spec.grade(c, answer, { model, condition, replica });
        // The row IS the progress indicator, and unlike a stderr dot it carries
        // information — and does not interleave into stdout when CI runs `2>&1 | tee`.
        const row = { id: c.id, condition, replica, model, score, cost };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
    }
    console.error(report(spec, rows));
    return 0;
  }

  console.error(
    `usage: ${spec.name}/run.mjs --emit-prompts [--n N]\n` +
      `       ${spec.name}/run.mjs --grade <answers.jsonl>\n` +
      `       ${spec.name}/run.mjs --models a,b [--n N] [--agent-cmd "<cmd>"] [--prompt-via argv|stdin]\n` +
      `conditions: ${conditions.join(" (treatment) vs ")} (baseline)`
  );
  return 2;
}
