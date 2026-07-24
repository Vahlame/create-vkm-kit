/**
 * Schema-budget gate for the obscura-web MCP server (ADR-0063).
 *
 * `obsidian-memory-mcp` has been gated since ADR-0035 on the principle that tool
 * descriptions are input tokens every wired agent pays every session. This server
 * had no such gate — and the WP0 inventory found it is the **largest single piece of
 * the kit's fixed layer**: 18,167 chars across 11 tools, more than the vault
 * server's 22 tools (10,748), wired by the default `--full` install.
 *
 * Two baselines are pinned here, and it matters which is which:
 *
 *  - `BUDGET_CHARS` is a real ceiling with ~2% headroom. Growth from here is a
 *    reviewed decision, same contract as the vault server.
 *  - `MAX_SINGLE_CHARS` is **a baseline to bring down, not a target that was
 *    chosen**. The vault server holds itself to 450 chars per description; this
 *    server's longest is 1,475 — 3.3× that. Trimming them is a change to what the
 *    model reads, so it belongs to a measured pass, not a drive-by edit here
 *    (anti-objective: don't delete or reshape functionality just because it is
 *    newly measured). What this gate buys today is that the number cannot grow
 *    silently while that pass is pending.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSchemaStrings } from "../../../scripts/context-budget.mjs";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "obscura-mcp.mjs");

/** Measured 18,167 chars over 11 tools / 81 schema strings (2026-07-24, v4.5.1). */
const BUDGET_CHARS = 18500;
/** Measured longest single description: 1,475 chars. See the note above — this is
 * the debt, recorded, not the standard. The standard is the vault server's 450. */
const MAX_SINGLE_CHARS = 1500;

test("total tool-schema text stays within the recorded budget", () => {
  const strings = extractSchemaStrings(readFileSync(SRC, "utf8"));
  assert.ok(
    strings.length >= 40,
    `extractor should find the schema strings (got ${strings.length})`
  );
  const total = strings.reduce((a, s) => a + s.length, 0);
  assert.ok(
    total <= BUDGET_CHARS,
    `schema text grew to ${total} chars (budget ${BUDGET_CHARS}). This server is the ` +
      `largest single piece of the kit's fixed layer — trim or justify in the same PR.`
  );
});

test("no single description exceeds the recorded per-string maximum", () => {
  const strings = extractSchemaStrings(readFileSync(SRC, "utf8"));
  for (const s of strings) {
    assert.ok(
      s.length <= MAX_SINGLE_CHARS,
      `description of ${s.length} chars exceeds ${MAX_SINGLE_CHARS}: "${s.slice(0, 80)}…"`
    );
  }
});

test("concatenated descriptions are measured whole, not just their first fragment", () => {
  // This server writes nearly every description as `"a" + "b" + "c"`. A
  // first-fragment-only reader measured it at 5,772 chars — 32% of the truth — so
  // the property is asserted rather than assumed.
  const src = readFileSync(SRC, "utf8");
  const anchors =
    (src.match(/description:/g) ?? []).length +
    (src.match(/instructions:/g) ?? []).length +
    (src.match(/\.describe\(/g) ?? []).length;
  const strings = extractSchemaStrings(src);
  assert.equal(strings.length, anchors, "every schema anchor must yield exactly one string");
  assert.ok(
    strings.some((s) => s.length > 800),
    "at least one multi-fragment description must be read past its first literal"
  );
});
