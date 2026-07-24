/**
 * Schema-budget gate (ADR-0035, hardened by ADR-0063): the MCP tool descriptions +
 * server instructions are input tokens EVERY wired agent pays EVERY session, whether
 * or not a tool is called. This test pins their total size so schema bloat is a
 * failing build, not a silent per-session tax — the same philosophy as the
 * token-economy benchmark (measured, CI-gated), applied to the kit's own fixed cost.
 *
 * It parses the source (no server spawn) via the shared extractor in
 * `scripts/context-budget.mjs`. That shared extractor replaced a local regex that
 * matched only the FIRST literal of a description: this file happens to use one
 * string per description, so the old regex measured correctly here — but only by
 * luck. The moment a description was refactored to `"a" + "b"`, the measured total
 * would have collapsed and this gate would have passed a schema of any size without
 * failing. Sibling servers (`obscura-mcp.mjs`, `downloads-mcp.mjs`) are written that
 * way today, which is how the gap was found. The gate no longer depends on a
 * formatting accident.
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
import { extractSchemaStrings } from "../../../scripts/context-budget.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src", "hybrid-mcp.mjs");

// Measured 7,641 chars after the ADR-0035 trim (down from 10,226); 9,006 after
// adding vault_delete_file / vault_move_file — two destructive-capable tools
// whose safety rails (soft-delete-to-.trash default, protected core notes, no
// wikilink rewriting) must be visible in the schema, not discovered by error.
// 10,622 after the note-lifecycle set (vault_append_file / vault_frontmatter_set /
// vault_backlinks / vault_git_history / vault_rotate_log): five tools at ~320
// chars each, already trimmed to the load-bearing contract (EOL normalization,
// scalar-keys-only, read-only markers, recovery semantics).
// Headroom of ~2% covers a new param or two; a whole new tool must pay its way.
const BUDGET_CHARS = 10800;
// No single description should be a treatise: the longest legitimate one (the
// hybrid-search tool description) sits under this after the trim. This is the
// standard the kit holds itself to; the sibling servers do not meet it yet and
// carry their current maximum as an explicit baseline (see their own gates).
const MAX_SINGLE_CHARS = 450;

test("total tool-schema text stays within the token budget", () => {
  const strings = extractSchemaStrings(readFileSync(SRC, "utf8"));
  assert.ok(
    strings.length >= 40,
    `extractor should find the schema strings (got ${strings.length})`
  );
  const total = strings.reduce((a, s) => a + s.length, 0);
  assert.ok(
    total <= BUDGET_CHARS,
    `schema text grew to ${total} chars (budget ${BUDGET_CHARS}). ` +
      `Every char here is paid per session by every wired agent — trim or justify.`
  );
});

test("no single description exceeds the per-string cap", () => {
  const strings = extractSchemaStrings(readFileSync(SRC, "utf8"));
  for (const s of strings) {
    assert.ok(
      s.length <= MAX_SINGLE_CHARS,
      `description of ${s.length} chars exceeds ${MAX_SINGLE_CHARS}: "${s.slice(0, 80)}…"`
    );
  }
});

test("the extractor reads one string per schema anchor — nothing measured as 0", () => {
  // The failure this pins is silent under-measurement: an anchor whose text the
  // extractor cannot read contributes 0 chars and the gate passes for free.
  const src = readFileSync(SRC, "utf8");
  const anchors =
    (src.match(/description:/g) ?? []).length +
    (src.match(/instructions:/g) ?? []).length +
    (src.match(/\.describe\(/g) ?? []).length;
  assert.equal(
    extractSchemaStrings(src).length,
    anchors,
    "every description/instructions/.describe() anchor must yield exactly one measured string"
  );
});
