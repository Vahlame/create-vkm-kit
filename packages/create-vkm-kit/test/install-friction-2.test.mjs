// Friction defects found by auditing a fresh-machine install path (v5.3.0).
import test from "node:test";
import assert from "node:assert/strict";
import { registerViaCli } from "../src/mcp-register.mjs";

/** Capture console.log/warn for one call. */
async function captured(fn) {
  const lines = [];
  const { log, warn } = console;
  console.log = (...a) => lines.push(a.join(" "));
  console.warn = (...a) => lines.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return lines.join("\n");
}

const SERVERS = /** @type {Array<[string, object]>} */ ([
  ["basic-memory", { command: "x" }],
  ["obsidian-memory-hybrid", { command: "x" }],
  ["obscura-web", { command: "x" }],
  ["vkm-downloads", { command: "x" }]
]);

const client = {
  bin: "vkm-definitely-not-a-real-cli",
  label: "Nonexistent CLI",
  addArgv: (name) => ["mcp", "add", name],
  removeArgv: (name) => ["mcp", "remove", name],
  manualBlock: (name) => `[mcp_servers.${name}]\ncommand = "x"`
};

test("a missing client CLI is reported ONCE, not once per server", async () => {
  const out = await captured(() => registerViaCli(client, SERVERS, false));

  const mentions = out.split("\n").filter((l) => l.includes("is not installed")).length;
  assert.equal(mentions, 1, `expected a single skip line, got:\n${out}`);

  // The paste-ready TOML for a CLI the user does not have is pure noise — four of them
  // read like four failures in an install that actually succeeded.
  assert.ok(!out.includes("[mcp_servers."), `must not dump manual TOML blocks:\n${out}`);
  assert.ok(out.includes("4 servers"), "should say what was skipped");
});

test("dry-run still prints the commands it would run for an absent CLI", async () => {
  // A dry run documents intent; suppressing it because the CLI is missing would make
  // `--dry-run` a worse preview on exactly the machines that need the preview.
  const out = await captured(() => registerViaCli(client, SERVERS, true));
  assert.equal(out.split("\n").filter((l) => l.includes("mcp add")).length, 4);
});
