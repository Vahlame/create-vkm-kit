#!/usr/bin/env node
// Hidden grader for the dedupe-emails task (data domain). Imports a subject solution that exports
// dedupeEmails(list) and scores it against edge-case tests it never sees.
//   node grade.mjs <path-to-solution.mjs>  → prints JSON { passed, total, score, fails }
import { pathToFileURL } from "node:url";

const solutionPath = process.argv[2];
if (!solutionPath) {
  console.error("usage: node grade.mjs <solution.mjs>");
  process.exit(2);
}

let dedupeEmails;
try {
  ({ dedupeEmails } = await import(pathToFileURL(solutionPath).href));
  if (typeof dedupeEmails !== "function") throw new Error("no dedupeEmails export");
} catch (e) {
  console.log(JSON.stringify({ passed: 0, total: 1, score: 0, fails: ["import: " + e.message] }));
  process.exit(0);
}

// Order is unspecified, so compare as sets.
const eqSet = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  [...a].sort().join("|") === [...b].sort().join("|");

const expectEq = (input, expected) => {
  try {
    return eqSet(dedupeEmails(input), expected);
  } catch {
    return false;
  }
};
const expectThrow = (input) => {
  try {
    dedupeEmails(input);
    return false;
  } catch {
    return true;
  }
};

const cases = [
  ["basic", () => expectEq(["a@b.com", "c@d.co"], ["a@b.com", "c@d.co"])],
  ["dup-exact", () => expectEq(["a@b.com", "a@b.com"], ["a@b.com"])],
  ["dup-case", () => expectEq(["A@B.com", "a@b.com"], ["a@b.com"])],
  ["trim", () => expectEq([" x@y.com "], ["x@y.com"])],
  ["case+trim-dup", () => expectEq(["Foo@Bar.COM", " foo@bar.com "], ["foo@bar.com"])],
  ["empty-array", () => expectEq([], [])],
  ["invalid-no-at-throws", () => expectThrow(["notanemail"])],
  ["invalid-double-at-throws", () => expectThrow(["a@@b.com"])],
  ["invalid-no-dot-throws", () => expectThrow(["a@b"])],
  ["empty-string-throws", () => expectThrow([""])],
  ["ws-only-throws", () => expectThrow(["   "])],
  ["one-invalid-throws", () => expectThrow(["a@b.com", ""])]
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
