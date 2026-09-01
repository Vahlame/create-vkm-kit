// evidence-gates.mjs behavior tests: the cross-platform runner must keep the same
// contract as the .sh fallback — PASS/FAIL block on stdout, exit 0 = all green,
// 1 = a gate failed, 2 = bad directory, and "no gates detected" is exit 0 with a
// notice (absence of gates is a finding, not a failure).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "skills",
  "vkm-discipline",
  "scripts",
  "evidence-gates.mjs"
);

function runIn(dir) {
  try {
    const out = execFileSync(process.execPath, [RUNNER, dir], { encoding: "utf8" });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

function tmp(entries) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "evidence-gates-"));
  for (const [rel, content] of Object.entries(entries)) {
    const fp = path.join(dir, rel);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, content);
  }
  return dir;
}

test("a failing npm test gate fails the run (exit 1, FAIL line)", () => {
  const dir = tmp({
    "package.json": JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } })
  });
  try {
    const { status, out } = runIn(dir);
    assert.equal(status, 1);
    assert.match(out, /FAIL {2}npm run test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a passing npm test gate passes the run (exit 0, PASS line)", () => {
  const dir = tmp({
    "package.json": JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } })
  });
  try {
    const { status, out } = runIn(dir);
    assert.equal(status, 0);
    assert.match(out, /PASS {2}npm run test/);
    assert.match(out, /1 passed, 0 failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lint is only detected when the package declares it", () => {
  const dir = tmp({
    "package.json": JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } })
  });
  try {
    const { out } = runIn(dir);
    assert.doesNotMatch(out, /npm run lint/, "lint must not run when undeclared");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty project is exit 0 with the no-gates notice", () => {
  const dir = tmp({});
  try {
    const { status, out } = runIn(dir);
    assert.equal(status, 0);
    assert.match(out, /no gates detected/);
    assert.match(out, /That absence IS the finding/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a nonexistent directory exits 2", () => {
  const { status, out } = runIn(path.join(os.tmpdir(), "evidence-gates-does-not-exist-xyz"));
  assert.equal(status, 2);
  assert.match(out, /cannot cd/);
});
