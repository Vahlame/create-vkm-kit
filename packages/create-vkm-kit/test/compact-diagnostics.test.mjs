/**
 * Diagnostic-preservation gate for the token-saver's Bash compaction (ADR-0043):
 * on REAL noisy failure logs (adversarial fixtures: the decisive error buried
 * mid-stream between hundreds of progress lines), compaction must keep every
 * line a human would need to diagnose the failure. This is the deterministic
 * companion to the live A/B in evals/token-quality-ab — if this fails, the hook
 * is provably lossy and the A/B question is already answered.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compactText, MUST_KEEP_RE } from "../src/hooks/compact-tool-output.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "compact-fixtures");

/** The one line per fixture a diagnosis is impossible without. */
const DECISIVE = {
  "npm-build-fail.txt": "TS2339: Property 'retryCount' does not exist on type 'RequestConfig'.",
  "pytest-fail.txt": "E       AssertionError: assert 'conflict' == 'clean'",
  "go-race-fail.txt": "WARNING: DATA RACE",
  // Adversarial: a silent-drift "success" log whose decisive lines carry none of the
  // classic error keywords — the case that CAUGHT the pre-drift-keywords regex dropping
  // reconciliation output entirely (round-3 diversification finding).
  "etl-silent-drift.txt": "[etl] reconciliation: ledger total 97531, report total 97532"
};

test("every fixture actually triggers compaction (they are adversarial, not trivial)", () => {
  for (const name of Object.keys(DECISIVE)) {
    const raw = readFileSync(path.join(FIXTURES, name), "utf8");
    const { changed } = compactText(raw);
    assert.ok(changed, `${name}: expected compaction to fire (fixture too small?)`);
  }
});

test("the decisive error line survives compaction verbatim", () => {
  for (const [name, decisive] of Object.entries(DECISIVE)) {
    const raw = readFileSync(path.join(FIXTURES, name), "utf8");
    const { text } = compactText(raw);
    assert.ok(text.includes(decisive), `${name}: decisive line lost by compaction:\n  ${decisive}`);
  }
});

test("file:line locations named in the failure survive compaction", () => {
  const locations = {
    "npm-build-fail.txt": "src/api/client.ts:47",
    "pytest-fail.txt": "tests/test_sync.py:88",
    "go-race-fail.txt": "state.go:161",
    "etl-silent-drift.txt": "row 4412"
  };
  for (const [name, loc] of Object.entries(locations)) {
    const raw = readFileSync(path.join(FIXTURES, name), "utf8");
    const { text } = compactText(raw);
    assert.ok(text.includes(loc), `${name}: file:line "${loc}" lost by compaction`);
  }
});

test("every MUST_KEEP line in head/tail and the first maxRescued of the middle survive", () => {
  // Pin the hook's actual guarantee so a silent weakening (smaller window, lower
  // rescue cap dropping EARLY diagnostics) is a red build, not a surprise in the field.
  for (const name of readdirSync(FIXTURES)) {
    const raw = readFileSync(path.join(FIXTURES, name), "utf8");
    const { text } = compactText(raw);
    // eslint-disable-next-line no-control-regex -- strips the same ANSI CSI escapes the hook strips
    const cleanedLines = raw.replace(/\[[0-9;?]*[ -/]*[@-~]/g, "").split("\n");
    const diagnostics = cleanedLines.filter((l) => MUST_KEEP_RE.test(l));
    assert.ok(diagnostics.length > 0, `${name}: fixture has no diagnostic lines?`);
    const kept = diagnostics.filter((l) => text.includes(l.trim()) || text.includes(l));
    assert.ok(
      kept.length >= Math.min(diagnostics.length, 40),
      `${name}: only ${kept.length}/${diagnostics.length} diagnostic lines survived (guarantee: min(all, 40))`
    );
  }
});
