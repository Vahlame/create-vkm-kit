/**
 * Schema-budget gate for the vkm-downloads MCP server (ADR-0063).
 *
 * Smaller stakes than its siblings — this server is opt-in (`--downloads`, never
 * folded into `--full`, ADR-0058), so its 5,236 chars are only paid by users who
 * asked for it. Gated anyway for the same reason the others are: an ungated
 * description budget only ever drifts upward, and "it's opt-in" is how the largest
 * ungated piece of the fixed layer got that way.
 *
 * As with obscura-web, `MAX_SINGLE_CHARS` records the current maximum rather than
 * endorsing it; the standard is the vault server's 450.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSchemaStrings } from "../../../scripts/context-budget.mjs";

const SRC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "downloads-mcp.mjs"
);

/** Measured 5,236 chars over 6 tools / 20 schema strings (2026-07-24, v4.5.1). */
const BUDGET_CHARS = 5400;
/** Measured longest single description: 1,149 chars. Recorded, not endorsed. */
const MAX_SINGLE_CHARS = 1200;

test("total tool-schema text stays within the recorded budget", () => {
  const strings = extractSchemaStrings(readFileSync(SRC, "utf8"));
  assert.ok(
    strings.length >= 15,
    `extractor should find the schema strings (got ${strings.length})`
  );
  const total = strings.reduce((a, s) => a + s.length, 0);
  assert.ok(
    total <= BUDGET_CHARS,
    `schema text grew to ${total} chars (budget ${BUDGET_CHARS}) — trim or justify.`
  );
});

test("no single description exceeds the recorded per-string maximum", () => {
  for (const s of extractSchemaStrings(readFileSync(SRC, "utf8"))) {
    assert.ok(
      s.length <= MAX_SINGLE_CHARS,
      `description of ${s.length} chars exceeds ${MAX_SINGLE_CHARS}: "${s.slice(0, 80)}…"`
    );
  }
});

test("the extractor reads one string per schema anchor", () => {
  const src = readFileSync(SRC, "utf8");
  const anchors =
    (src.match(/description:/g) ?? []).length +
    (src.match(/instructions:/g) ?? []).length +
    (src.match(/\.describe\(/g) ?? []).length;
  assert.equal(extractSchemaStrings(src).length, anchors);
});
