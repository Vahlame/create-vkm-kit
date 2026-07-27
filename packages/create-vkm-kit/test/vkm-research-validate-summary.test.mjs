/**
 * validate_summary.mjs (vkm-research skill's consolidation validator). Covers the exported
 * `validateSummary` function directly, plus a real subprocess invocation — the subprocess case
 * is a regression test: the entry-point guard used to compare `import.meta.url` against
 * `file://${process.argv[1]}`, which never matches on Windows (backslashes, no `/C:/`
 * drive-letter form), so `node validate_summary.mjs <args>` silently printed nothing and exited
 * 0 — indistinguishable from a real pass to anything that only checks the exit code.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSummary } from "../templates/skills/vkm-research/scripts/validate_summary.mjs";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "skills",
  "vkm-research",
  "scripts",
  "validate_summary.mjs"
);

const GOOD = `---
status: consolidated
consolidated: 2026-07-23
sources: ["a.md"]
---

# topic — consolidated

A real synthesized claim connecting to [[PROJECTS/example]] with enough body text to clear
the 200-char floor comfortably, written as prose rather than as a per-source transcription.
`;

test("validateSummary: a real consolidation passes clean", () => {
  const res = validateSummary(GOOD);
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.equal(res.counts.wikilinks, 1);
});

test("validateSummary: zero wikilinks is an error", () => {
  const res = validateSummary(GOOD.replace("[[PROJECTS/example]]", "the project"));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /wikilink/.test(e)));
});

test("validateSummary: a promoted draft's seams are all caught", () => {
  const draft = `---
status: consolidated
---

## a.md
url: "https://x"
title: "X"

body one

---

## b.md

body two [[PROJECTS/example]]
`;
  const res = validateSummary(draft);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /chunk separators/.test(e)));
  assert.ok(res.errors.some((e) => /"## <file>\.md"/.test(e)));
  assert.ok(res.errors.some((e) => /leaked/.test(e)));
});

test("validateSummary: a well-formed supersedes line still validates on CRLF content (vault notes are CRLF)", () => {
  const crlf = (GOOD + "\n- supersedes [[RESEARCH/x/summary]] — reason\n").replace(/\n/g, "\r\n");
  const res = validateSummary(crlf);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.counts.supersedes, 1);
});

test("validateSummary: over 60% of source size is flagged as transcription", () => {
  const sourcesText = "x".repeat(10000);
  const bloated = GOOD + "y".repeat(7000);
  const res = validateSummary(bloated, { sourcesText });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /transcription/.test(e)));
});

test("CLI subprocess: runs main() and prints real output on THIS platform (regression for the Windows entry-point bug)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "validate-summary-cli-"));
  const file = path.join(dir, "summary.md");
  writeFileSync(file, GOOD, "utf8");

  const out = execFileSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  assert.match(out, /vkm-research validate:/, "must print the real report, not silently no-op");
  assert.match(out, /OK — reads as a real consolidation/);
});

test("CLI subprocess: exits 1 and reports errors on an invalid summary", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "validate-summary-cli-"));
  const file = path.join(dir, "summary.md");
  writeFileSync(file, "no frontmatter, no links, too short", "utf8");

  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, file], { encoding: "utf8" }),
    (e) => e.status === 1 && /ERROR/.test(e.stdout)
  );
});
