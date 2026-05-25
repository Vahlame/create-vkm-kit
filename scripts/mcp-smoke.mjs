#!/usr/bin/env node
// CI smoke for the default `basic-memory` MCP server via real JSON-RPC handshake.
// Spins up `uvx basic-memory mcp` against a temp vault, lists tools, verifies
// the core read/write/search tools exist. Replaces the prior `uvx --help` check.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REQUIRED_TOOLS = ["read_note", "write_note", "search_notes"];
const TIMEOUT_MS = 60_000;

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label} after ${ms}ms`)), ms))
  ]);
}

async function main() {
  const vault = await mkdtemp(path.join(tmpdir(), "obs-mem-smoke-"));
  await writeFile(path.join(vault, "START_HERE.md"), "# smoke\n", "utf8");

  const transport = new StdioClientTransport({
    command: "uvx",
    args: ["basic-memory", "mcp"],
    env: { ...process.env, BASIC_MEMORY_HOME: vault }
  });
  const client = new Client({ name: "ci-smoke", version: "1.0.0" }, { capabilities: {} });

  try {
    await withTimeout(client.connect(transport), TIMEOUT_MS, "connect");
    const { tools } = await withTimeout(client.listTools(), TIMEOUT_MS, "listTools");
    const names = tools.map((t) => t.name);
    const missing = REQUIRED_TOOLS.filter((r) => !names.includes(r));
    if (missing.length) {
      console.error(`mcp-smoke: missing required tools: ${missing.join(", ")}`);
      console.error(`available: ${names.join(", ")}`);
      process.exit(1);
    }
    console.log(`mcp-smoke ok: ${tools.length} tools (incl. ${REQUIRED_TOOLS.join(", ")})`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("mcp-smoke failed:", err?.message ?? err);
  process.exit(1);
});
