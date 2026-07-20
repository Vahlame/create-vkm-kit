import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeManagedBlock, installRules, CURSOR_RULE_FRONTMATTER } from "../src/rules-merge.mjs";
import { memoryRulesBlock, RULES_START, RULES_END } from "../src/memory-rules.mjs";

const block = memoryRulesBlock("en");

test("mergeManagedBlock: empty input → just the block, single trailing newline", () => {
  const out = mergeManagedBlock("", block);
  assert.ok(out.includes(RULES_START) && out.includes(RULES_END));
  assert.ok(out.endsWith("\n") && !out.endsWith("\n\n"));
});

test("mergeManagedBlock: appends after existing user content, preserving it", () => {
  const user = "# My personal rules\n\nAlways use tabs.\n";
  const out = mergeManagedBlock(user, block);
  assert.ok(out.startsWith("# My personal rules"), "keeps user heading first");
  assert.ok(out.includes("Always use tabs."), "keeps user content");
  assert.ok(out.includes(RULES_START), "adds the managed block");
});

test("mergeManagedBlock: replaces ONLY between markers; surrounding content survives", () => {
  const doc = "# Top\n\n" + RULES_START + "\n\nOLD BLOCK\n\n" + RULES_END + "\n\n# Bottom note\n";
  const out = mergeManagedBlock(doc, block);
  assert.ok(out.includes("# Top"), "content above survives");
  assert.ok(out.includes("# Bottom note"), "content below survives");
  assert.ok(!out.includes("OLD BLOCK"), "stale block removed");
  assert.ok(out.includes("Markdown memory"), "new block content present");
  assert.equal(out.split(RULES_START).length - 1, 1, "exactly one start marker");
  assert.equal(out.split(RULES_END).length - 1, 1, "exactly one end marker");
});

test("mergeManagedBlock: idempotent (running twice yields the same result)", () => {
  const once = mergeManagedBlock("# Mine\n", block);
  const twice = mergeManagedBlock(once, block);
  assert.equal(twice, once);
});

// Pins the contract the repo's dogfooding drift gate relies on (scripts/sync-agents.ts):
// what a fresh cursor install actually writes must equal the gate's rendered expectation,
// CURSOR_RULE_FRONTMATTER + memoryRulesBlock("es") through mergeManagedBlock — otherwise
// the gate would demand a file the generator can never produce.
test("installRules cursor fresh install: byte-equal to frontmatter + managed block", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rules-merge-cursor-"));
  try {
    const written = await installRules(["cursor"], "es", { home: cwd, cwd });
    const fp = path.join(cwd, ".cursor", "rules", "obsidian-memory.mdc");
    assert.deepEqual(written, [fp], "cursor target writes exactly one file");
    const got = fs.readFileSync(fp, "utf8");
    assert.equal(got, mergeManagedBlock(CURSOR_RULE_FRONTMATTER, memoryRulesBlock("es")));
    assert.ok(got.startsWith(CURSOR_RULE_FRONTMATTER), "frontmatter survives verbatim on top");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
