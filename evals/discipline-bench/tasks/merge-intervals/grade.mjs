#!/usr/bin/env node
// Hidden grader for the merge-intervals task (coding domain, under-specified).
// HELD-OUT instrument: written after the skills were last edited and never used to
// tune them (evals/README.md roadmap: the cheap anti-overfitting defense). The prompt
// shows only the happy path; the inferred contract: input may be unsorted, touching
// intervals merge ([1,2],[2,3] → [1,3]), contained intervals collapse, output sorted
// by start, input not mutated, invalid interval (non-numeric, start > end) throws.
//   node grade.mjs <path-to-solution.mjs>  → JSON { passed, total, score, fails }
import { pathToFileURL } from "node:url";

const solutionPath = process.argv[2];
if (!solutionPath) {
  console.error("usage: node grade.mjs <solution.mjs>");
  process.exit(2);
}

let mergeIntervals;
try {
  ({ mergeIntervals } = await import(pathToFileURL(solutionPath).href));
  if (typeof mergeIntervals !== "function") throw new Error("no mergeIntervals export");
} catch (e) {
  console.log(JSON.stringify({ passed: 0, total: 1, score: 0, fails: ["import: " + e.message] }));
  process.exit(0);
}

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (input, expected) => {
  try {
    return deepEq(mergeIntervals(input), expected);
  } catch {
    return false;
  }
};
const throws = (input) => {
  try {
    mergeIntervals(input);
    return false;
  } catch {
    return true;
  }
};

const tests = [
  [
    "happy path",
    () =>
      eq(
        [
          [1, 3],
          [2, 6],
          [8, 10]
        ],
        [
          [1, 6],
          [8, 10]
        ]
      )
  ],
  [
    "already disjoint",
    () =>
      eq(
        [
          [1, 2],
          [4, 5]
        ],
        [
          [1, 2],
          [4, 5]
        ]
      )
  ],
  [
    "unsorted input",
    () =>
      eq(
        [
          [8, 10],
          [1, 3],
          [2, 6]
        ],
        [
          [1, 6],
          [8, 10]
        ]
      )
  ],
  [
    "touching intervals merge",
    () =>
      eq(
        [
          [1, 2],
          [2, 3]
        ],
        [[1, 3]]
      )
  ],
  [
    "contained interval collapses",
    () =>
      eq(
        [
          [1, 10],
          [3, 4]
        ],
        [[1, 10]]
      )
  ],
  ["single interval", () => eq([[5, 7]], [[5, 7]])],
  ["empty input → empty output", () => eq([], [])],
  [
    "zero-length interval ok",
    () =>
      eq(
        [
          [2, 2],
          [1, 5]
        ],
        [[1, 5]]
      )
  ],
  [
    "chain of merges",
    () =>
      eq(
        [
          [1, 4],
          [4, 5],
          [5, 9]
        ],
        [[1, 9]]
      )
  ],
  [
    "input not mutated",
    () => {
      const input = [
        [8, 10],
        [1, 3]
      ];
      const copy = JSON.parse(JSON.stringify(input));
      try {
        mergeIntervals(input);
      } catch {
        return false;
      }
      return deepEq(input, copy);
    }
  ],
  ["reversed interval throws", () => throws([[5, 1]])],
  ["non-numeric throws", () => throws([[1, "b"]])],
  ["non-array element throws", () => throws([7])],
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
