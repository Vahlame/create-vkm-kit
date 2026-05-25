import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASIC_MEMORY_VERSION,
  mergeBasicMemoryServer,
  mergeObsidianHybridServer,
  resolveKitRepoRoot
} from "../src/mcp-merge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("mergeBasicMemoryServer adds basic-memory with absolute vault and pinned version", () => {
  const out = mergeBasicMemoryServer({}, "/abs/vault");
  assert.equal(out.mcpServers["basic-memory"].command, "uvx");
  assert.deepEqual(out.mcpServers["basic-memory"].args, [
    "--from",
    `basic-memory==${BASIC_MEMORY_VERSION}`,
    "basic-memory",
    "mcp"
  ]);
  assert.equal(out.mcpServers["basic-memory"].env.BASIC_MEMORY_HOME, "/abs/vault");
});

test("mergeBasicMemoryServer preserves other servers", () => {
  const out = mergeBasicMemoryServer({ mcpServers: { other: { command: "true" } } }, "/v");
  assert.equal(out.mcpServers.other.command, "true");
  assert.ok(out.mcpServers["basic-memory"]);
});

test("mergeObsidianHybridServer adds obsidian-memory-hybrid with absolute paths", () => {
  const base = mergeBasicMemoryServer({}, "/vault");
  const out = mergeObsidianHybridServer(base, "/vault", repoRoot);
  assert.ok(out.mcpServers["basic-memory"]);
  assert.equal(out.mcpServers["obsidian-memory-hybrid"].command, "node");
  assert.ok(
    String(out.mcpServers["obsidian-memory-hybrid"].args[0]).endsWith(
      path.join("packages", "obsidian-memory-mcp", "src", "hybrid-mcp.mjs")
    )
  );
  assert.equal(out.mcpServers["obsidian-memory-hybrid"].env.BASIC_MEMORY_HOME, "/vault");
  assert.ok(
    out.mcpServers["obsidian-memory-hybrid"].env.PYTHONPATH.includes("obsidian-memory-rag")
  );
});

test("resolveKitRepoRoot finds repo from cwd walk", async () => {
  const nested = path.join(repoRoot, "packages", "create-obsidian-memory", "dist");
  const found = await resolveKitRepoRoot({
    cwd: nested,
    argv: [],
    pathExists: (p) =>
      fs.promises
        .access(p)
        .then(() => true)
        .catch(() => false)
  });
  assert.equal(path.resolve(found), path.resolve(repoRoot));
});
