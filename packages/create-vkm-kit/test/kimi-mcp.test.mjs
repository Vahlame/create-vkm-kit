/**
 * Kimi Code MCP registration: `writeKimiMcp` merges the kit's servers into
 * `~/.kimi-code/mcp.json` (or `$KIMI_CODE_HOME/mcp.json`) with the same
 * merge-preserve-backup contract as Cursor — Kimi Code has no `mcp add` CLI, its JSON
 * file IS the documented config surface.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeKimiMcp } from "../src/mcp-register.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Run `fn` with console.log silenced. */
async function quiet(fn) {
  const orig = console.log;
  console.log = () => {};
  try {
    await fn();
  } finally {
    console.log = orig;
  }
}

/** Run `fn` with KIMI_CODE_HOME set to `value` (or deleted when null), then restored. */
async function withKimiCodeHome(value, fn) {
  const prior = process.env.KIMI_CODE_HOME;
  if (value === null) delete process.env.KIMI_CODE_HOME;
  else process.env.KIMI_CODE_HOME = value;
  try {
    await fn();
  } finally {
    if (prior === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = prior;
  }
}

test("writeKimiMcp merges into ~/.kimi-code/mcp.json, preserving foreign entries", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-kimi-mcp-"));
  await withKimiCodeHome(null, async () => {
    const dir = path.join(home, ".kimi-code");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "mcp.json"),
      JSON.stringify({ mcpServers: { "someone-elses": { command: "npx", args: ["x"] } } })
    );

    await quiet(() => writeKimiMcp(home, "/vault", false, { launcher: null }));
    const merged = JSON.parse(fs.readFileSync(path.join(dir, "mcp.json"), "utf8"));
    assert.ok(merged.mcpServers["basic-memory"], "kit server added");
    assert.equal(
      merged.mcpServers["someone-elses"].command,
      "npx",
      "pre-existing entry survives the merge"
    );
    assert.equal(
      merged.mcpServers["basic-memory"].env.BASIC_MEMORY_HOME,
      "/vault",
      "vault env var set"
    );
  });
});

test("writeKimiMcp backs up a pre-existing mcp.json before overwriting", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-kimi-mcp-"));
  await withKimiCodeHome(null, async () => {
    const dir = path.join(home, ".kimi-code");
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, "mcp.json");
    fs.writeFileSync(fp, JSON.stringify({ mcpServers: {} }));

    await quiet(() => writeKimiMcp(home, "/vault", false, { launcher: null }));
    const backups = fs.readdirSync(dir).filter((n) => n.startsWith("mcp.json.bak."));
    assert.equal(backups.length, 1, "exactly one timestamped backup");
  });
});

test("writeKimiMcp dry-run writes nothing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-kimi-mcp-"));
  await withKimiCodeHome(null, async () => {
    await quiet(() => writeKimiMcp(home, "/vault", true, { launcher: null }));
    assert.ok(!fs.existsSync(path.join(home, ".kimi-code", "mcp.json")));
  });
});

test("writeKimiMcp honors KIMI_CODE_HOME over ~/.kimi-code", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-kimi-mcp-"));
  const custom = path.join(home, "custom-kimi-home");
  await withKimiCodeHome(custom, async () => {
    await quiet(() => writeKimiMcp(home, "/vault", false, { launcher: null }));
    assert.ok(
      fs.existsSync(path.join(custom, "mcp.json")),
      "written under the KIMI_CODE_HOME override"
    );
    assert.ok(
      !fs.existsSync(path.join(home, ".kimi-code", "mcp.json")),
      "default location untouched"
    );
  });
});

test("writeKimiMcp wires the hybrid server when given a kit clone", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-kimi-mcp-"));
  await withKimiCodeHome(null, async () => {
    await quiet(() =>
      writeKimiMcp(home, "/vault", false, { withHybrid: true, repoRoot, launcher: null })
    );
    const merged = JSON.parse(fs.readFileSync(path.join(home, ".kimi-code", "mcp.json"), "utf8"));
    assert.ok(merged.mcpServers["obsidian-memory-hybrid"], "hybrid server present");
  });
});
