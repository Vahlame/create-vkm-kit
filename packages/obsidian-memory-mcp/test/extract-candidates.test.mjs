import test from "node:test";
import assert from "node:assert/strict";
// Import from ./extract.mjs (pure helpers), NOT from ./hybrid-mcp.mjs — the
// latter would spawn StdioServerTransport on import and hang `node --test`
// forever waiting on stdin. The hybrid module re-exports these for back-compat
// but tests stay decoupled from the MCP server lifecycle.
import { classifyBullet, extractBullets, pickQueryTerms, routeForKind } from "../src/extract.mjs";

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

// --- classifyBullet / routeForKind (ADR-0038, evolutive memory) -------------------

test("classifyBullet: failures win over co-present decision words, EN + ES", () => {
  assert.equal(
    classifyBullet("Decided to add retries after the S3 upload failed with a timeout"),
    "failure"
  );
  assert.equal(classifyBullet("La migración falló por un lock de tabla en Postgres"), "failure");
  assert.equal(classifyBullet("Root cause of the crash was an unbounded queue"), "failure");
});

test("classifyBullet: gotcha / preference / decision / fact routing, EN + ES", () => {
  assert.equal(classifyBullet("Watch out: the flag only works if the index exists"), "gotcha");
  assert.equal(classifyBullet("Ojo: solo funciona si el índice ya existe"), "gotcha");
  assert.equal(classifyBullet("User prefers conventional commits with scope"), "preference");
  assert.equal(classifyBullet("Siempre usar tabs en Go, nunca usar espacios"), "preference");
  assert.equal(classifyBullet("We decided to use UUIDv7 for primary keys"), "decision");
  assert.equal(classifyBullet("Decidimos usar SQLite WAL para el índice"), "decision");
  assert.equal(classifyBullet("The vault lives under BASIC_MEMORY_HOME"), "fact");

  assert.equal(routeForKind("failure"), "KNOWN_FAILURES.md");
  assert.equal(routeForKind("preference"), "MEMORY.md");
  assert.match(routeForKind("gotcha"), /STACKS|PRACTICES/);
  assert.match(routeForKind("decision"), /PROJECTS/);
  assert.equal(routeForKind("fact"), "MEMORY.md");
});
