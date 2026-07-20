import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeRunReport, ResearchPersistError } from "../src/research-persist.mjs";

async function freshRoot() {
  return mkdtemp(path.join(tmpdir(), "obscura-run-report-"));
}

test("writeRunReport: writes under <topic>/runs/ and returns { path, filename }", async () => {
  const root = await freshRoot();
  const res = await writeRunReport({
    topic: "cats",
    content: "# Deep research run: cats\n\nbody",
    researchDir: root
  });
  assert.equal(res.path, path.join(root, "cats", "runs", res.filename));

  const text = await readFile(res.path, "utf8");
  assert.equal(text, "# Deep research run: cats\n\nbody");

  const files = await readdir(path.join(root, "cats", "runs"));
  assert.deepEqual(files, [res.filename]);
});

test("writeRunReport: default filename is a millisecond-ISO timestamp ending in .md", async () => {
  const root = await freshRoot();
  const res = await writeRunReport({ topic: "cats", content: "x", researchDir: root });
  assert.match(res.filename, /^\d{4}-\d{2}-\d{2}T.*\.md$/);
});

test("writeRunReport: explicit filename is respected", async () => {
  const root = await freshRoot();
  const res = await writeRunReport({
    topic: "cats",
    content: "x",
    filename: "custom-run.md",
    researchDir: root
  });
  assert.equal(res.filename, "custom-run.md");
  assert.equal(res.path, path.join(root, "cats", "runs", "custom-run.md"));
  assert.equal(await readFile(res.path, "utf8"), "x");
});

test("writeRunReport: re-running with the SAME explicit filename overwrites that one run, not history", async () => {
  const root = await freshRoot();
  await writeRunReport({ topic: "cats", content: "first", filename: "r.md", researchDir: root });
  await writeRunReport({ topic: "cats", content: "second", filename: "r.md", researchDir: root });
  const files = await readdir(path.join(root, "cats", "runs"));
  assert.deepEqual(files, ["r.md"]);
  assert.equal(await readFile(path.join(root, "cats", "runs", "r.md"), "utf8"), "second");
});

test("writeRunReport: unsafe/invalid filenames are rejected, nothing written outside (or inside) the topic dir", async () => {
  const root = await freshRoot();
  const bad = ["../escape.md", "..%2F..%2Fpwn.md", "no-extension"];
  for (const filename of bad) {
    await assert.rejects(
      () => writeRunReport({ topic: "cats", content: "x", filename, researchDir: root }),
      (e) =>
        e instanceof ResearchPersistError &&
        (e.code === "invalid_filename" || e.code === "path_escape")
    );
  }
  // Every rejection happens before any filesystem write — the topic dir was never even created.
  await assert.rejects(() => readdir(path.join(root, "cats")));
  // And nothing landed at the naive traversal targets either.
  await assert.rejects(() => readFile(path.join(root, "escape.md"), "utf8"));
  await assert.rejects(() => readFile(path.join(root, "pwn.md"), "utf8"));
});

test("writeRunReport: invalid topic is rejected", async () => {
  const root = await freshRoot();
  await assert.rejects(
    () => writeRunReport({ topic: "../escape", content: "x", researchDir: root }),
    (e) => e instanceof ResearchPersistError && e.code === "invalid_topic"
  );
  // Rejected before any filesystem write — the fresh tmp root stays empty.
  assert.deepEqual(await readdir(root), []);
});

test("writeRunReport: missing OBSCURA_RESEARCH_DIR (and no researchDir) -> missing_root", async () => {
  const prev = process.env.OBSCURA_RESEARCH_DIR;
  delete process.env.OBSCURA_RESEARCH_DIR;
  try {
    await assert.rejects(
      () => writeRunReport({ topic: "cats", content: "x" }),
      (e) => e instanceof ResearchPersistError && e.code === "missing_root"
    );
  } finally {
    if (prev === undefined) delete process.env.OBSCURA_RESEARCH_DIR;
    else process.env.OBSCURA_RESEARCH_DIR = prev;
  }
});
