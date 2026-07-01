import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContext,
  truncateIndex,
  MAX_INDEX_CHARS,
  reminders
} from "../src/hooks/session-start-vault-context.mjs";

function setupVault() {
  const vault = mkdtempSync(join(tmpdir(), "session-start-ctx-"));
  mkdirSync(join(vault, "_meta"));
  mkdirSync(join(vault, "PROJECTS"));
  return vault;
}

test("truncateIndex leaves a short index untouched", () => {
  const short = "# index\n\nsmall content\n";
  assert.equal(truncateIndex(short, "es"), short);
});

test("truncateIndex caps a long index with a notice pointing at vault_read_file", () => {
  const long = "x".repeat(MAX_INDEX_CHARS + 500);
  const out = truncateIndex(long, "es");
  assert.ok(out.length < long.length);
  assert.match(out, /truncado/);
  assert.match(out, /vault_read_file\("_meta\/index\.md"\)/);
});

test("truncateIndex english notice", () => {
  const long = "x".repeat(MAX_INDEX_CHARS + 500);
  const out = truncateIndex(long, "en");
  assert.match(out, /truncated/);
});

test("buildContext caps the injected index.md content", () => {
  const vault = setupVault();
  try {
    writeFileSync(join(vault, "_meta", "index.md"), "y".repeat(MAX_INDEX_CHARS * 3));
    const ctx = buildContext(vault, "es");
    // The whole additionalContext string must stay bounded even though the source
    // index.md is far larger — this is the fixed per-session token tax.
    assert.ok(ctx.length < MAX_INDEX_CHARS * 3);
    assert.match(ctx, /truncado/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("buildContext includes a short index.md verbatim (no truncation notice)", () => {
  const vault = setupVault();
  try {
    writeFileSync(join(vault, "_meta", "index.md"), "# index\n\nshort\n");
    const ctx = buildContext(vault, "es");
    assert.match(ctx, /short/);
    assert.doesNotMatch(ctx, /truncado/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("buildContext degrades gracefully with no vault at all", () => {
  const ctx = buildContext("", "es");
  assert.equal(ctx, buildContext("", "es")); // deterministic
  assert.match(ctx, /MEMORIA/); // reminders always present
});

test("reminders mention the vault precedence rule in both languages", () => {
  assert.match(reminders("es"), /UNICA fuente de verdad/);
  assert.match(reminders("en"), /ONLY source of truth/);
});
