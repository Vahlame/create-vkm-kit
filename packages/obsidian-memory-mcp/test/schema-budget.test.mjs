/**
 * Schema-budget gate (ADR-0035): the MCP tool descriptions + server instructions
 * are input tokens EVERY wired agent pays EVERY session, whether or not a tool is
 * called. This test pins their total size so schema bloat is a failing build, not
 * a silent per-session tax — the same philosophy as the token-economy benchmark
 * (measured, CI-gated), applied to the kit's own fixed cost.
 *
 * It parses the source (no server spawn): every string literal fed to
 * `description:`, `.describe(` or `instructions:` in hybrid-mcp.mjs.
 *
 * If this fails because you added a genuinely load-bearing description, trim an
 * existing one to pay for it (or raise the budget in the same PR as a deliberate,
 * reviewed decision — never as a drive-by).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "hybrid-mcp.mjs");

// Measured 7,641 chars after the ADR-0035 trim (down from 10,226). Headroom of
// ~5% covers a new param or two; a whole new tool must pay its way.
const BUDGET_CHARS = 8000;
// No single description should be a treatise: the longest legitimate one (the
// hybrid-search tool description) sits under this after the trim.
const MAX_SINGLE_CHARS = 450;

function schemaStrings(src) {
  const re = /(?:description:|instructions:|\.describe\()\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;
  return [...src.matchAll(re)].map((m) => m[1]);
}

test("total tool-schema text stays within the token budget", () => {
  const strings = schemaStrings(readFileSync(SRC, "utf8"));
  assert.ok(strings.length >= 40, `regex should find the schema strings (got ${strings.length})`);
  const total = strings.reduce((a, s) => a + s.length, 0);
  assert.ok(
    total <= BUDGET_CHARS,
    `schema text grew to ${total} chars (budget ${BUDGET_CHARS}). ` +
      `Every char here is paid per session by every wired agent — trim or justify.`
  );
});

test("no single description exceeds the per-string cap", () => {
  const strings = schemaStrings(readFileSync(SRC, "utf8"));
  for (const s of strings) {
    assert.ok(
      s.length <= MAX_SINGLE_CHARS,
      `description of ${s.length} chars exceeds ${MAX_SINGLE_CHARS}: "${s.slice(0, 80)}…"`
    );
  }
});
