#!/usr/bin/env node
// Hidden grader for the parse-range task. Imports a subject solution that exports
// parseRange(s) and scores it against edge-case tests the subject never sees.
//   node grade.mjs <path-to-solution.mjs>  → prints JSON { passed, total, score, fails }
import { pathToFileURL } from "node:url";

const solutionPath = process.argv[2];
if (!solutionPath) {
  console.error("usage: node grade.mjs <solution.mjs>");
  process.exit(2);
}

let parseRange;
try {
  ({ parseRange } = await import(pathToFileURL(solutionPath).href));
  if (typeof parseRange !== "function") throw new Error("no parseRange export");
} catch (e) {
  console.log(JSON.stringify({ passed: 0, total: 1, score: 0, fails: ["import: " + e.message] }));
  process.exit(0);
}

const arrEq = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

const expectEq = (input, expected) => {
  try {
    return arrEq(parseRange(input), expected);
  } catch {
    return false;
  }
};
const expectThrow = (input) => {
  try {
    parseRange(input);
    return false;
  } catch {
    return true;
  }
};

const cases = [
  ["basic", () => expectEq("1-5,8,11-13", [1, 2, 3, 4, 5, 8, 11, 12, 13])],
  ["single", () => expectEq("5", [5])],
  ["zero", () => expectEq("0", [0])],
  ["whitespace", () => expectEq(" 1 , 2 , 3 ", [1, 2, 3])],
  ["unsorted", () => expectEq("3,1,2", [1, 2, 3])],
  ["overlap", () => expectEq("1-3,2-4", [1, 2, 3, 4])],
  ["dupes", () => expectEq("1,1,1", [1])],
  ["single-range", () => expectEq("10-10", [10])],
  ["empty-throws", () => expectThrow("")],
  ["ws-only-throws", () => expectThrow("   ")],
  ["empty-token-throws", () => expectThrow("1,,2")],
  ["reversed-throws", () => expectThrow("5-1")],
  ["malformed-throws", () => expectThrow("1-2-3")],
  ["nonnum-throws", () => expectThrow("a,2")],
  ["negative-throws", () => expectThrow("-1,2")],
  ["noninteger-throws", () => expectThrow("1.5")]
];

const fails = [];
let passed = 0;
for (const [name, fn] of cases) {
  let ok = false;
  try {
    ok = fn();
  } catch {
    ok = false;
  }
  if (ok) passed++;
  else fails.push(name);
}
const total = cases.length;
console.log(JSON.stringify({ passed, total, score: Math.round((passed / total) * 100), fails }));
