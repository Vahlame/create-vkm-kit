#!/usr/bin/env node
// Hidden grader for the parse-duration task (coding domain, under-specified). Imports a
// subject solution exporting parseDuration(s) and scores it against edge cases the
// subject never sees. The prompt shows only the happy path; the inferred contract is:
// integer non-negative components, units h/m/s each at most once in h→m→s order,
// at least one component, invalid input throws.
//   node grade.mjs <path-to-solution.mjs>  → JSON { passed, total, score, fails }
import { pathToFileURL } from "node:url";

const solutionPath = process.argv[2];
if (!solutionPath) {
  console.error("usage: node grade.mjs <solution.mjs>");
  process.exit(2);
}

let parseDuration;
try {
  ({ parseDuration } = await import(pathToFileURL(solutionPath).href));
  if (typeof parseDuration !== "function") throw new Error("no parseDuration export");
} catch (e) {
  console.log(JSON.stringify({ passed: 0, total: 1, score: 0, fails: ["import: " + e.message] }));
  process.exit(0);
}

const eq = (input, expected) => {
  try {
    return parseDuration(input) === expected;
  } catch {
    return false;
  }
};
const throws = (input) => {
  try {
    parseDuration(input);
    return false;
  } catch {
    return true;
  }
};

const tests = [
  ["happy path 1h30m", () => eq("1h30m", 5400)],
  ["single unit seconds", () => eq("45s", 45)],
  ["single unit hours", () => eq("2h", 7200)],
  ["all three units", () => eq("1h1m1s", 3661)],
  ["zero component allowed", () => eq("0h5m", 300)],
  ["multi-digit values", () => eq("12h90m", 48600)],
  ["whitespace-tolerant OR strict-throw", () => eq(" 1h ", 3600) || throws(" 1h ")],
  ["empty string throws", () => throws("")],
  ["unitless number throws", () => throws("90")],
  ["unknown unit throws", () => throws("1d")],
  ["negative value throws", () => throws("-1h")],
  ["decimal value throws OR handled exactly", () => throws("1.5h") || eq("1.5h", 5400)],
  ["duplicate unit throws", () => throws("1h2h")],
  ["out-of-order units throw", () => throws("30m1h")],
  ["garbage throws", () => throws("abc")],
  ["null throws", () => throws(null)]
];

const fails = [];
let passed = 0;
for (const [name, fn] of /** @type {[string, () => boolean][]} */ (tests)) {
  let ok;
  try {
    ok = fn();
  } catch {
    ok = false;
  }
  if (ok) passed++;
  else fails.push(name);
}
console.log(
  JSON.stringify({
    passed,
    total: tests.length,
    score: Math.round((passed / tests.length) * 100),
    fails
  })
);
