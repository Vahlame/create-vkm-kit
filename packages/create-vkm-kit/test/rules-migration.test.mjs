import test from "node:test";
import assert from "node:assert/strict";
import { mergeManagedBlock, installRules } from "../src/rules-merge.mjs";
import {
  RULES_START,
  RULES_END,
  LEGACY_RULES_START,
  LEGACY_RULES_END,
  memoryRulesBlock
} from "../src/memory-rules.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A "3.15-era" CLAUDE.md: user content around a legacy-sentinel managed block. */
function legacyFile() {
  return [
    "# My own rules",
    "",
    "Keep my stuff.",
    "",
    LEGACY_RULES_START,
    "",
    "old managed body from a pre-rename release",
    "",
    LEGACY_RULES_END,
    "",
    "## More of my content",
    "after the block."
  ].join("\n");
}

test("mergeManagedBlock migrates a legacy-sentinel block in place (ADR-0041)", () => {
  const merged = mergeManagedBlock(legacyFile(), memoryRulesBlock("es"));
  assert.ok(merged.includes(RULES_START), "new sentinels written");
  assert.ok(merged.includes(RULES_END));
  assert.ok(!merged.includes(LEGACY_RULES_START), "legacy sentinels gone");
  assert.ok(!merged.includes("old managed body"), "legacy body replaced");
  assert.ok(merged.includes("# My own rules"), "user content before survives");
  assert.ok(merged.includes("after the block."), "user content after survives");
  assert.equal(merged.split(RULES_START).length - 1, 1, "exactly one managed block");
});

test("migration is idempotent: a second merge changes nothing", () => {
  const once = mergeManagedBlock(legacyFile(), memoryRulesBlock("es"));
  const twice = mergeManagedBlock(once, memoryRulesBlock("es"));
  assert.equal(twice, once);
});

test("end-to-end: installRules over a legacy ~/.claude/CLAUDE.md leaves one migrated block", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rules-migration-"));
  const fp = path.join(home, ".claude", "CLAUDE.md");
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, legacyFile(), "utf8");
  await installRules(["claude"], "es", { home, cwd: home });
  const text = fs.readFileSync(fp, "utf8");
  assert.equal(text.split(RULES_START).length - 1, 1);
  assert.ok(!text.includes(LEGACY_RULES_START));
  assert.ok(text.includes("Keep my stuff."));
});
