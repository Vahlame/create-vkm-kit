import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveProject } from "../src/project-resolve.mjs";

function makeVaultWithProjects(names) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-compiler-proj-"));
  fs.mkdirSync(path.join(vault, "PROJECTS"));
  for (const n of names) fs.writeFileSync(path.join(vault, "PROJECTS", `${n}.md`), "# " + n, "utf8");
  return vault;
}

test("resolveProject matches an exact --project name (no prompt needed)", async () => {
  const vault = makeVaultWithProjects(["demo-app", "other"]);
  const r = await resolveProject({ vault, projectFlag: "demo-app", nonInteractive: true });
  assert.equal(r.projectName, "demo-app");
  assert.equal(r.projectNote, "PROJECTS/demo-app.md");
});

test("resolveProject matches case-insensitively", async () => {
  const vault = makeVaultWithProjects(["Demo-App"]);
  const r = await resolveProject({ vault, projectFlag: "demo-app", nonInteractive: true });
  assert.equal(r.projectName, "Demo-App");
});

test("resolveProject resolves a single unambiguous partial match", async () => {
  const vault = makeVaultWithProjects(["app-ap-sport-inv", "other"]);
  const r = await resolveProject({ vault, projectFlag: "ap-sport", nonInteractive: true });
  assert.equal(r.projectName, "app-ap-sport-inv");
});

test("resolveProject: nonInteractive + no match -> null note, doesn't throw", async () => {
  const vault = makeVaultWithProjects(["alpha", "beta"]);
  const r = await resolveProject({ vault, projectFlag: "zzz-nope", nonInteractive: true });
  assert.equal(r.projectNote, null);
});

test("resolveProject: missing PROJECTS/ directory degrades gracefully", async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-compiler-noproj-"));
  const r = await resolveProject({ vault, nonInteractive: true });
  assert.equal(r.projectNote, null);
  assert.deepEqual(r.candidates, []);
});

test("resolveProject: nonInteractive with no --project and projects existing -> still no note (no prompt fired)", async () => {
  const vault = makeVaultWithProjects(["alpha"]);
  const r = await resolveProject({ vault, nonInteractive: true });
  assert.equal(r.projectNote, null);
  assert.deepEqual(r.candidates, ["alpha"]);
});
