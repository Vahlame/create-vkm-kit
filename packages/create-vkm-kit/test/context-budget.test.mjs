/**
 * WP0 baseline (ADR-0063) — the kit's fixed context layer, recorded.
 *
 * This is a TRIPWIRE, not a budget. ADR-0035 and ADR-0036 gate the two pieces whose
 * size was already a reviewed decision (vault schemas, rules block); the rest of the
 * fixed layer — obscura's schemas above all — has never been measured, so gating it
 * now would be picking a number out of the air. What this test does instead:
 *
 *  1. pins the COMPOSITION (every always-paid piece present, classified, attributable),
 *  2. pins the TOTAL inside a wide band, so a doubling fails the build and a normal
 *     edit doesn't,
 *  3. pins WHY the extractor follows string concatenation — the property the shipped
 *     schema gate silently depends on and does not itself verify.
 *
 * Turning (2) into a real budget is a later, reviewed decision, taken with the
 * off-target number (WP1) in hand — never as a drive-by.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  measureRepo,
  measureInstalled,
  extractSchemaStrings,
  approxTokens
} from "../../../scripts/context-budget.mjs";
import { memoryRulesBlock } from "../src/memory-rules.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Measured 2026-07-24 on v4.5.1 (`node scripts/context-budget.mjs`). The band is
 * ±20%: wide enough that trimming or adding a description is not a build failure,
 * tight enough that a new MCP server or a doubled rules block cannot land unnoticed.
 */
const BASELINE = { alwaysChars: 45_247, worstCaseChars: 76_891 };
const BAND = 0.2;

test("fixed-layer composition: every always-paid piece is present and attributable", () => {
  const { pieces } = measureRepo({ lang: "es" });
  const always = pieces.filter((p) => p.when === "always").map((p) => p.id);
  for (const id of [
    "rules-block:es",
    "mcp-schemas:vault",
    "mcp-schemas:obscura",
    "session-start:reminders:es",
    "session-start:index",
    "output-style:vkm-terse",
    "subagent-desc:vkm-implementer"
  ]) {
    assert.ok(always.includes(id), `always-paid piece missing from the inventory: ${id}`);
  }
  for (const p of pieces) {
    assert.ok(p.chars > 0, `${p.id} measured 0 chars — the extractor lost it`);
    assert.match(p.source, /^[\w./-]+:\d+$/, `${p.id} has no file:line attribution`);
    assert.equal(p.tokens, approxTokens(p.chars));
  }
});

test("the four skills are each counted twice: description always, body on trigger", () => {
  const { pieces } = measureRepo({ lang: "es" });
  const descs = pieces.filter((p) => p.id.startsWith("skill-desc:"));
  const bodies = pieces.filter((p) => p.id.startsWith("skill-body:"));
  assert.equal(descs.length, 4);
  assert.equal(bodies.length, 4);
  assert.ok(descs.every((p) => p.when === "always"));
  assert.ok(bodies.every((p) => p.when === "on-trigger"));
});

test("downloads is opt-in, so it stays out of the always total", () => {
  const { pieces } = measureRepo({ lang: "es" });
  const dl = pieces.find((p) => p.id === "mcp-schemas:downloads");
  assert.equal(dl.when, "opt-in", "vkm-downloads is deliberately NOT in --full (ADR-0058)");
});

for (const lang of ["es", "en"]) {
  test(`fixed-layer total (${lang}) stays within the recorded band`, () => {
    const { totals } = measureRepo({ lang });
    for (const key of ["alwaysChars", "worstCaseChars"]) {
      const lo = Math.round(BASELINE[key] * (1 - BAND));
      const hi = Math.round(BASELINE[key] * (1 + BAND));
      assert.ok(
        totals[key] >= lo && totals[key] <= hi,
        `${key} (${lang}) = ${totals[key]}, outside the recorded band [${lo}, ${hi}] ` +
          `(baseline ${BASELINE[key]}). Every char here is a permanent behavioural prior — ` +
          `move the baseline in the same PR as a deliberate, reviewed decision.`
      );
    }
  });
}

test("extractor follows '+' concatenation — the property the schema gate depends on", () => {
  // The gate's own regex (schema-budget.test.mjs) matches only the FIRST literal of a
  // concatenated description. It is currently honest solely because hybrid-mcp.mjs has
  // no concatenation; obscura-mcp.mjs is written the other way and proves the gap.
  const naive = (src) => [
    ...src.matchAll(/(?:description:|instructions:|\.describe\()\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)
  ];
  const vault = fs.readFileSync(
    path.join(ROOT, "packages/obsidian-memory-mcp/src/hybrid-mcp.mjs"),
    "utf8"
  );
  const obscura = fs.readFileSync(
    path.join(ROOT, "packages/obscura-web/src/obscura-mcp.mjs"),
    "utf8"
  );
  const sum = (ss) => ss.reduce((a, s) => a + s.length, 0);

  // Where there is no concatenation, the two agree exactly — so this extractor is a
  // strict superset of the gate's, not a different measurement.
  assert.equal(
    sum(extractSchemaStrings(vault)),
    sum(naive(vault).map((m) => m[1])),
    "extractors must agree on a file with no concatenated descriptions"
  );
  // Where there is, the naive one undercounts badly.
  assert.ok(
    sum(extractSchemaStrings(obscura)) > sum(naive(obscura).map((m) => m[1])) * 2,
    "obscura's concatenated descriptions must expose the naive regex's undercount"
  );
});

test("extractor reads exactly one string per schema anchor (no misses, no phantoms)", () => {
  for (const rel of [
    "packages/obsidian-memory-mcp/src/hybrid-mcp.mjs",
    "packages/obscura-web/src/obscura-mcp.mjs",
    "packages/vkm-downloads/src/downloads-mcp.mjs"
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const anchors =
      (src.match(/description:/g) ?? []).length +
      (src.match(/instructions:/g) ?? []).length +
      (src.match(/\.describe\(/g) ?? []).length;
    assert.equal(
      extractSchemaStrings(src).length,
      anchors,
      `${rel}: extracted strings must match schema anchors 1:1`
    );
  }
});

test("installed view counts the rules block once per surface a session loads", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-budget-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-budget-cwd-"));
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const block = memoryRulesBlock("es");

  // Nothing installed yet: no surface, no multiplier.
  assert.equal(measureInstalled({ home, cwd, lang: "es" }).rulesMultiplier, 0);

  // What `--full` writes: project AGENTS.md + ~/.claude/CLAUDE.md + ~/.codex/AGENTS.md
  // (index.js:234-240). A Claude Code session in `cwd` loads the first two.
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), `# user\n\n${block}`);
  fs.writeFileSync(path.join(home, ".codex", "AGENTS.md"), block);
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), `# project\n\n${block}`);

  const full = measureInstalled({ home, cwd, lang: "es" });
  assert.deepEqual(full.surfacesPresent.sort(), ["agents", "claude", "codex"]);
  assert.deepEqual(full.surfacesLoadedByClaudeCode.sort(), ["agents", "claude"]);
  assert.equal(full.rulesMultiplier, 2, "Claude Code loads the global AND the project block");

  // The second loaded surface is a second full payment, not a rounding error.
  const repo = measureRepo({ lang: "es" });
  assert.equal(full.totals.alwaysChars, repo.totals.alwaysChars + block.length);
});
