/**
 * The shared bench CLI, and the reporting rule it makes unavoidable.
 *
 * Before this module the rule lived as prose in METHODOLOGY.md §5 and as an unimported
 * library in stats.mjs, so nothing could fail when a RESULTS.md bolded a delta off n=2.
 * These tests pin the part that matters: what the report is allowed to emphasise.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { report, runBenchCli, readJsonl, flag } from "./bench-cli.mjs";

/** A bench whose grade is "length of the answer", so no model is involved. */
const spec = {
  name: "fake-bench",
  cases: [{ id: "a" }, { id: "b" }],
  conditions: /** @type {[string, string]} */ (["treat", "base"]),
  subjectPrompt: (c, condition) => `${c.id}:${condition}`,
  grade: (c, answer) => String(answer).length,
  defaultN: 2
};

/** Capture console.log / console.error for one call. */
async function capture(fn) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  try {
    const code = await fn();
    return { code, out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("flag() reads --name value and returns undefined when absent", () => {
  assert.equal(flag(["--n", "5"], "--n"), "5");
  assert.equal(flag(["--n", "5"], "--models"), undefined);
});

test("--emit-prompts fans out cases x conditions x replicas", async () => {
  const { code, out } = await capture(() => runBenchCli(spec, ["--emit-prompts", "--n", "3"]));
  assert.equal(code, 0);
  assert.equal(out.length, 2 * 2 * 3);
  const first = JSON.parse(out[0]);
  assert.deepEqual(
    { id: first.id, condition: first.condition, replica: first.replica, prompt: first.prompt },
    { id: "a", condition: "treat", replica: 1, prompt: "a:treat" }
  );
  // Treatment first, always: a positive delta must mean the same thing in every bench.
  assert.equal(JSON.parse(out[0]).condition, "treat");
});

test("--emit-prompts honours the bench's defaultN when --n is absent", async () => {
  const { out } = await capture(() => runBenchCli(spec, ["--emit-prompts"]));
  assert.equal(out.length, 2 * 2 * 2);
});

test("no recognised mode prints usage and exits 2", async () => {
  const { code, err } = await capture(() => runBenchCli(spec, []));
  assert.equal(code, 2);
  assert.match(err.join("\n"), /--emit-prompts/);
});

test("--grade scores every answer, rows on stdout and the report on stderr", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bench-cli-"));
  const file = path.join(dir, "answers.jsonl");
  writeFileSync(
    file,
    [
      { id: "a", condition: "treat", replica: 1, model: "m", answer: "xxxx" },
      { id: "a", condition: "base", replica: 1, model: "m", answer: "xx" }
    ]
      .map((o) => JSON.stringify(o))
      .join("\n") + "\n"
  );
  const { code, out, err } = await capture(() => runBenchCli(spec, ["--grade", file]));
  assert.equal(code, 0);
  assert.equal(out.length, 2, "one JSONL row per answer, on stdout");
  assert.equal(JSON.parse(out[0]).score, 4);
  assert.equal(JSON.parse(out[1]).score, 2);
  assert.match(err.join("\n"), /fake-bench — 2 answers/, "the human report goes to stderr");
});

test("--grade skips an answer whose id is not a known case, without crashing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bench-cli-"));
  const file = path.join(dir, "answers.jsonl");
  writeFileSync(file, JSON.stringify({ id: "ghost", condition: "treat", answer: "x" }) + "\n");
  const { code, out, err } = await capture(() => runBenchCli(spec, ["--grade", file]));
  assert.equal(code, 0);
  assert.equal(out.length, 0);
  assert.match(err.join("\n"), /no case with id "ghost"/);
});

test("readJsonl ignores blank and whitespace-only lines", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bench-cli-"));
  const file = path.join(dir, "x.jsonl");
  writeFileSync(file, '{"a":1}\n\n   \n{"a":2}\n');
  assert.deepEqual(readJsonl(file), [{ a: 1 }, { a: 2 }]);
});

// --- the reporting rule -----------------------------------------------------------

const rows = (condition, scores, model = "m") =>
  scores.map((score, i) => ({ id: "a", condition, replica: i + 1, model, score }));

test("a delta below MIN_N is directional and never bolded", () => {
  const text = report(spec, [...rows("treat", [100, 100]), ...rows("base", [0, 0])]);
  assert.match(text, /directional, n=2/);
  assert.doesNotMatch(text, /\*\*/, "n=2 may not produce a bold delta, however large");
});

test("a separated delta at n>=MIN_N is bolded", () => {
  const text = report(spec, [
    ...rows("treat", [100, 100, 100, 100, 100]),
    ...rows("base", [0, 0, 0, 0, 0])
  ]);
  assert.match(text, /\*\*\+100\.0\*\*/);
  assert.match(text, /cliffs=1\.00 \(large\)/);
});

test("an overlapping delta at n>=MIN_N is inconclusive, not a win", () => {
  const text = report(spec, [
    ...rows("treat", [50, 60, 40, 55, 45]),
    ...rows("base", [52, 58, 41, 54, 46])
  ]);
  assert.match(text, /inconclusive/);
  assert.doesNotMatch(text, /\*\*/);
});

test("the report names an empty cell instead of inventing a delta", () => {
  const text = report(spec, rows("treat", [10, 20]));
  assert.match(text, /a cell is empty/);
});

test("cost, when the rows carry it, reaches both the cell line and the delta line", () => {
  const withCost = (condition, scores, tokens) =>
    rows(condition, scores).map((r) => ({
      ...r,
      cost: { totalTokens: tokens, outputTokens: 10, turns: 1, wallClockMs: 1000, costUsd: 0.01 }
    }));
  const text = report(spec, [
    ...withCost("treat", [80, 80, 80, 80, 80], 2000),
    ...withCost("base", [40, 40, 40, 40, 40], 1000)
  ]);
  assert.match(text, /tok=2000/);
  assert.match(text, /tok=1000/);
  assert.match(text, /Δtok=1000/);
  // +40 points for +1000 tokens → 40 points per 1k tokens.
  assert.match(text, /40\.00 pts\/1k tok/);
});

test("a cell with no cost data prints no cost, rather than zeros", () => {
  const text = report(spec, [...rows("treat", [10, 20]), ...rows("base", [10, 20])]);
  assert.doesNotMatch(text, /tok=/);
});
