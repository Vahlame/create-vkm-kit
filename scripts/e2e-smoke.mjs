#!/usr/bin/env node
// End-to-end smoke of the FULL local stack — the one thing the per-component
// benches never proved: install → index → search → write → search-again, through
// the real hybrid MCP server over real stdio, against a scaffolded vault.
//
//  1. runs the actual installer (temp HOME/vault, no IDE registration, no git)
//  2. indexes the scaffolded vault with the real Python engine
//  3. connects to hybrid-mcp.mjs over stdio and drives the tools:
//     vault_hybrid_search → hit on seeded content; vault_write_file → new note;
//     vault_fts_index → refresh; search again → the new note is findable.
//
// Requires: node, python3 with obsidian-memory-rag importable (PYTHONPATH is set
// to the in-repo src — same wiring the installer produces). ~1–2 min. Exit 1 on
// any failed assertion, with the step named.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 90_000;
const PY =
  process.env.OBSIDIAN_MEMORY_PYTHON ?? (process.platform === "win32" ? "python" : "python3");

function step(name) {
  console.log(`e2e-smoke: ${name}`);
}
function withTimeout(p, label) {
  return Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`timeout: ${label} after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    )
  ]);
}
/** @param {unknown} res */
function firstText(res) {
  const content = /** @type {{content?: {type: string, text?: string}[]}} */ (res).content ?? [];
  return content.find((c) => c.type === "text")?.text ?? "";
}

async function main() {
  const home = mkdtempSync(path.join(tmpdir(), "vkm-e2e-home-"));
  const vault = mkdtempSync(path.join(tmpdir(), "vkm-e2e-vault-"));

  step("1/5 install (real installer, temp HOME, no IDE/git)");
  execFileSync(
    process.execPath,
    [
      path.join(REPO, "packages", "create-vkm-kit", "src", "index.js"),
      "--non-interactive",
      "-y",
      "--vault",
      vault,
      "--ide",
      "none",
      "--minimal",
      "--no-git",
      "--no-skills",
      "--no-agents"
    ],
    { env: { ...process.env, HOME: home }, stdio: "pipe", timeout: TIMEOUT_MS }
  );
  // Seed a note with a distinctive fact the search must find.
  writeFileSync(
    path.join(vault, "PROJECTS", "e2e-probe.md"),
    "# e2e probe\n\n- [decision] the smoke daemon uses flamingo-teal port 48123 #e2e\n",
    "utf8"
  );

  step("2/5 index (real Python engine)");
  const ragSrc = path.join(REPO, "packages", "obsidian-memory-rag", "src");
  execFileSync(PY, ["-m", "obsidian_memory_rag", "index", "--vault", vault], {
    env: { ...process.env, PYTHONPATH: ragSrc },
    stdio: "pipe",
    timeout: TIMEOUT_MS
  });

  step("3/5 connect hybrid-mcp over stdio");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(REPO, "packages", "obsidian-memory-mcp", "src", "hybrid-mcp.mjs")],
    env: {
      ...process.env,
      BASIC_MEMORY_HOME: vault,
      PYTHONPATH: ragSrc,
      OBSIDIAN_MEMORY_RAG_SRC: ragSrc
    }
  });
  const client = new Client({ name: "e2e-smoke", version: "1.0.0" }, { capabilities: {} });
  try {
    await withTimeout(client.connect(transport), "connect");
    const { tools } = await withTimeout(client.listTools(), "listTools");
    if (tools.length < 20) throw new Error(`expected 20+ tools, got ${tools.length}`);

    step("4/5 search seeded fact, then write a new note through the vault tools");
    const hit = await withTimeout(
      client.callTool({
        name: "vault_hybrid_search",
        arguments: { query: "flamingo-teal port", limit: 5 }
      }),
      "hybrid_search(seeded)"
    );
    if (!firstText(hit).includes("48123")) {
      throw new Error(
        `seeded fact not found by vault_hybrid_search: ${firstText(hit).slice(0, 300)}`
      );
    }

    const write = await withTimeout(
      client.callTool({
        name: "vault_write_file",
        arguments: {
          path: "STACKS/e2e-written.md",
          content:
            "# e2e written\n\n- [fact] the write path proves persimmon-indigo checksum 97531 #e2e\n"
        }
      }),
      "vault_write_file"
    );
    if (/error/i.test(firstText(write)) && !/etag/i.test(firstText(write))) {
      throw new Error(`vault_write_file failed: ${firstText(write).slice(0, 300)}`);
    }

    step("5/5 reindex and find the note written through the MCP");
    await withTimeout(
      client.callTool({ name: "vault_fts_index", arguments: {} }),
      "vault_fts_index"
    );
    const hit2 = await withTimeout(
      client.callTool({
        name: "vault_hybrid_search",
        arguments: { query: "persimmon-indigo checksum", limit: 5 }
      }),
      "hybrid_search(written)"
    );
    if (!firstText(hit2).includes("97531")) {
      throw new Error(
        `note written via MCP not found after reindex: ${firstText(hit2).slice(0, 300)}`
      );
    }

    console.log("e2e-smoke ok: install → index → search → write → search-again all verified");
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("e2e-smoke failed:", err?.message ?? err);
  process.exit(1);
});
