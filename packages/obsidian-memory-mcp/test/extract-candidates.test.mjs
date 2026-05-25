import test from "node:test";
import assert from "node:assert/strict";
// Import from ./extract.mjs (pure helpers), NOT from ./hybrid-mcp.mjs — the
// latter would spawn StdioServerTransport on import and hang `node --test`
// forever waiting on stdin. The hybrid module re-exports these for back-compat
// but tests stay decoupled from the MCP server lifecycle.
import { extractBullets, pickQueryTerms } from "../src/extract.mjs";

test("extractBullets pulls dash-prefixed items", () => {
  const summary = `Things from this session:
- We decided to use UUIDv7 for primary keys instead of autoincrement.
- The token TTL is now 24h, not 1h.
trivial`;
  const out = extractBullets(summary);
  assert.equal(out.length, 2);
  assert.match(out[0], /UUIDv7/);
  assert.match(out[1], /TTL/);
});

test("extractBullets falls back to sentence split when no bullets present", () => {
  const summary =
    "We decided to migrate to pnpm workspaces. The CI matrix should drop Node 18. Done.";
  const out = extractBullets(summary);
  // Two long sentences + one too-short "Done." stripped.
  assert.ok(out.length >= 2, `expected at least 2 sentences, got ${out.length}`);
});

test("extractBullets ignores trivial bullets", () => {
  const summary = `- ok
- this one is long enough to keep`;
  const out = extractBullets(summary);
  assert.equal(out.length, 1);
});

test("pickQueryTerms returns identifier-ish tokens up to 3", () => {
  const q = pickQueryTerms("Decided to use UUIDv7 instead of autoincrement integers.");
  const parts = q.split(/\s+/);
  assert.equal(parts.length, 3);
  // No punctuation-trailing artifacts; tokens are word-shape.
  for (const p of parts) {
    assert.match(p, /^[\w][\w-]*$/, `bad token: ${p}`);
  }
});

test("pickQueryTerms returns empty string when nothing meaningful", () => {
  assert.equal(pickQueryTerms("a is to be"), "");
});
