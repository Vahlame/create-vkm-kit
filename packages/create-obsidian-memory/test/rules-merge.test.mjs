import test from "node:test";
import assert from "node:assert/strict";
import { mergeManagedBlock } from "../src/rules-merge.mjs";
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
