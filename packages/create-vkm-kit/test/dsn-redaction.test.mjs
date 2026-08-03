/**
 * DSN credential redaction in everything the installer ECHOES (never in what it writes
 * or executes). What these pin:
 *
 *   - redactUserinfo masks exactly the `scheme://user:secret@` userinfo — URLs without
 *     credentials, bare host:port pairs and plain paths pass through untouched;
 *   - registerViaCli's dry-run echo of the `claude`/`codex` argv is masked, while the
 *     argv OBJECT itself (what execa would run) keeps the real DSN;
 *   - writeCursorMcp's dry-run JSON dump is masked, and a LIVE run still writes the real
 *     DSN into ~/.cursor/mcp.json — redaction is a console concern, not a file concern.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactUserinfo, registerViaCli, writeCursorMcp } from "../src/mcp-register.mjs";
import { claudeAddArgv, codexTomlBlock } from "../src/mcp-merge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DSN = "postgres://app:s3cret@db.example:5432/vkm";
const MASKED = "postgres://app:***@db.example:5432/vkm";

/** Run `fn` with console.log captured; returns every printed line joined. */
async function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines.join("\n");
}

test("redactUserinfo masks userinfo secrets and nothing else", () => {
  assert.equal(redactUserinfo(DSN), MASKED);
  assert.equal(
    redactUserinfo(`-e VKM_PG_DSN=${DSN} -- node srv.mjs`),
    `-e VKM_PG_DSN=${MASKED} -- node srv.mjs`,
    "the DSN is masked inside a command line"
  );
  const toml = codexTomlBlock("s", { command: "node", env: { VKM_PG_DSN: DSN } });
  assert.match(redactUserinfo(toml), /postgres:\/\/app:\*\*\*@db\.example/, "masked in TOML too");
  for (const untouched of [
    "http://127.0.0.1:4930/api/health",
    "no url at all",
    "postgres://db.example:5432/vkm", // no userinfo → nothing to mask
    "C:\\Users\\u\\.claude\\bin\\vkm-runhidden.exe"
  ]) {
    assert.equal(redactUserinfo(untouched), untouched, `must not rewrite: ${untouched}`);
  }
});

test("registerViaCli dry-run echoes the masked DSN, never the real one", async () => {
  const server = { command: "node", args: ["srv.mjs"], env: { VKM_PG_DSN: DSN } };
  const out = await captureLog(() =>
    registerViaCli(
      {
        bin: "claude",
        label: "Claude Code",
        addArgv: claudeAddArgv,
        removeArgv: (name) => ["mcp", "remove", name]
      },
      [["obsidian-memory-hybrid", server]],
      true
    )
  );
  assert.ok(!out.includes("s3cret"), `the password must not reach the console:\n${out}`);
  assert.ok(out.includes(MASKED), "the masked DSN is still shown so the command stays legible");
  // The argv that WOULD be executed keeps the real value — only the echo is masked.
  assert.ok(claudeAddArgv("x", server).join(" ").includes(DSN));
});

test("writeCursorMcp: dry-run dump is masked, the real file gets the real DSN", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-dsn-cursor-"));
  const opts = { withHybrid: true, repoRoot, postgres: true, pgDsn: DSN, launcher: null };

  const out = await captureLog(() => writeCursorMcp(home, "/vault", true, opts));
  assert.ok(!out.includes("s3cret"), `dry-run JSON must not leak the password:\n${out}`);
  assert.ok(out.includes(MASKED), "the dump still shows where the DSN goes");
  assert.ok(!fs.existsSync(path.join(home, ".cursor", "mcp.json")), "dry-run writes nothing");

  await captureLog(() => writeCursorMcp(home, "/vault", false, opts));
  const merged = JSON.parse(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8"));
  assert.equal(
    merged.mcpServers["obsidian-memory-hybrid"].env.VKM_PG_DSN,
    DSN,
    "the FILE carries the real DSN — redaction is only for the console"
  );
});
