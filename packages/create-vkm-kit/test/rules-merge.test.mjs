import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeManagedBlock, installRules, CURSOR_RULE_FRONTMATTER } from "../src/rules-merge.mjs";
import {
  memoryRulesBlock,
  cursorPointerBlock,
  RULES_START,
  RULES_END
} from "../src/memory-rules.mjs";

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

test("installRules cursor+agents on a project: pointer on Cursor surfaces, full block on AGENTS.md", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rules-merge-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rules-merge-proj-"));
  try {
    const written = await installRules(["agents", "cursor"], "es", { home, cwd });
    const agentsFp = path.join(cwd, "AGENTS.md");
    const userFp = path.join(home, ".cursor", "rules", "obsidian-memory.mdc");
    const projectFp = path.join(cwd, ".cursor", "rules", "obsidian-memory.mdc");
    assert.ok(
      written.includes(agentsFp) && written.includes(userFp) && written.includes(projectFp)
    );
    const agents = fs.readFileSync(agentsFp, "utf8");
    const user = fs.readFileSync(userFp, "utf8");
    const project = fs.readFileSync(projectFp, "utf8");
    assert.ok(agents.includes("referencia opcional"), "AGENTS.md keeps the full protocol");
    assert.ok(user.includes("puntero Cursor"), "user-global is the pointer");
    assert.ok(project.includes("puntero Cursor"), "project .mdc is the pointer");
    assert.ok(
      !user.includes("Libertad del agente"),
      "pointer must not embed the full core block"
    );
    assert.ok(
      user.length < memoryRulesBlock("es").length / 2,
      "pointer is cheaper than half a full block"
    );
    // Reinstall replaces a legacy full block in place.
    fs.writeFileSync(userFp, mergeManagedBlock(CURSOR_RULE_FRONTMATTER, memoryRulesBlock("es")));
    await installRules(["agents", "cursor"], "es", { home, cwd });
    const again = fs.readFileSync(userFp, "utf8");
    assert.ok(again.includes("puntero Cursor"));
    assert.equal(again.split(RULES_START).length - 1, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("installRules cursor-only on a distinct project: full protocol on project .mdc, pointer user-global", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rules-merge-chome-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rules-merge-ccwd-"));
  try {
    await installRules(["cursor"], "es", { home, cwd });
    const user = fs.readFileSync(
      path.join(home, ".cursor", "rules", "obsidian-memory.mdc"),
      "utf8"
    );
    const project = fs.readFileSync(
      path.join(cwd, ".cursor", "rules", "obsidian-memory.mdc"),
      "utf8"
    );
    assert.ok(user.includes("puntero Cursor"));
    assert.ok(project.includes("referencia opcional"));
    assert.ok(cursorPointerBlock("es").includes("vkm-kit:start"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("installRules kimi target writes the managed block to ~/.kimi-code/AGENTS.md", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "rules-merge-kimi-"));
  const prior = process.env.KIMI_CODE_HOME;
  delete process.env.KIMI_CODE_HOME;
  try {
    const written = await installRules(["kimi"], "es", { home: cwd, cwd });
    const fp = path.join(cwd, ".kimi-code", "AGENTS.md");
    assert.deepEqual(written, [fp], "kimi target writes exactly one file");
    const got = fs.readFileSync(fp, "utf8");
    assert.ok(got.includes(RULES_START) && got.includes(RULES_END), "managed block present");
    // Re-run replaces only the block; user content above survives.
    fs.writeFileSync(fp, "# Notas propias\n\n" + got, "utf8");
    await installRules(["kimi"], "es", { home: cwd, cwd });
    const again = fs.readFileSync(fp, "utf8");
    assert.ok(again.startsWith("# Notas propias"), "user content preserved");
    assert.equal(again.split(RULES_START).length - 1, 1, "still exactly one block");
  } finally {
    if (prior === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = prior;
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
