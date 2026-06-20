import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASIC_MEMORY_VERSION,
  SEMANTIC_EMBEDDER,
  mergeBasicMemoryServer,
  mergeObsidianHybridServer,
  basicMemoryServer,
  hybridServer,
  claudeAddArgv,
  codexAddArgv,
  codexRemoveArgv,
  codexTomlBlock,
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

test("mergeObsidianHybridServer with semantic wires the fastembed embedder", () => {
  const base = mergeBasicMemoryServer({}, "/vault");
  const plain = mergeObsidianHybridServer(base, "/vault", repoRoot);
  assert.equal(plain.mcpServers["obsidian-memory-hybrid"].env.OBSIDIAN_MEMORY_EMBEDDER, undefined);
  const sem = mergeObsidianHybridServer(base, "/vault", repoRoot, { semantic: true });
  assert.equal(
    sem.mcpServers["obsidian-memory-hybrid"].env.OBSIDIAN_MEMORY_EMBEDDER,
    SEMANTIC_EMBEDDER
  );
});

test("mergeObsidianHybridServer with vec wires the sqlite-vec flag (ADR-0025)", () => {
  const base = mergeBasicMemoryServer({}, "/vault");
  const plain = mergeObsidianHybridServer(base, "/vault", repoRoot);
  assert.equal(
    plain.mcpServers["obsidian-memory-hybrid"].env.OBSIDIAN_MEMORY_SQLITE_VEC,
    undefined
  );
  const withVec = mergeObsidianHybridServer(base, "/vault", repoRoot, {
    semantic: true,
    vec: true
  });
  const env = withVec.mcpServers["obsidian-memory-hybrid"].env;
  assert.equal(env.OBSIDIAN_MEMORY_SQLITE_VEC, "1");
  // vec is independent of semantic, but the `--full` install ships both.
  assert.equal(env.OBSIDIAN_MEMORY_EMBEDDER, SEMANTIC_EMBEDDER);
});

test("claudeAddArgv builds `claude mcp add -s user -e … -- cmd args`", () => {
  const argv = claudeAddArgv("basic-memory", basicMemoryServer("/v"));
  assert.deepEqual(argv.slice(0, 5), ["mcp", "add", "basic-memory", "-s", "user"]);
  assert.ok(argv.includes("BASIC_MEMORY_HOME=/v"));
  const dd = argv.indexOf("--");
  assert.ok(dd > 0);
  assert.deepEqual(argv.slice(dd + 1), [
    "uvx",
    "--from",
    `basic-memory==${BASIC_MEMORY_VERSION}`,
    "basic-memory",
    "mcp"
  ]);
});

test("claudeAddArgv for hybrid carries the semantic embedder env", () => {
  const argv = claudeAddArgv(
    "obsidian-memory-hybrid",
    hybridServer("/v", repoRoot, { semantic: true })
  );
  assert.ok(argv.some((a) => a.startsWith("OBSIDIAN_MEMORY_EMBEDDER=fastembed")));
  assert.equal(argv[argv.indexOf("--") + 1], "node");
});

test("codexAddArgv builds `mcp add <name> --env … -- cmd args` (no scope flag)", () => {
  const argv = codexAddArgv("basic-memory", basicMemoryServer("/v"));
  assert.deepEqual(argv.slice(0, 3), ["mcp", "add", "basic-memory"]);
  assert.ok(!argv.includes("-s"), "codex add takes no -s scope flag");
  // env is passed via repeatable --env KEY=VALUE
  const ei = argv.indexOf("--env");
  assert.ok(ei > 0);
  assert.equal(argv[ei + 1], "BASIC_MEMORY_HOME=/v");
  const dd = argv.indexOf("--");
  assert.ok(dd > ei, "launcher command comes after the -- separator");
  assert.deepEqual(argv.slice(dd + 1), [
    "uvx",
    "--from",
    `basic-memory==${BASIC_MEMORY_VERSION}`,
    "basic-memory",
    "mcp"
  ]);
});

test("codexAddArgv for hybrid carries the semantic embedder env", () => {
  const argv = codexAddArgv(
    "obsidian-memory-hybrid",
    hybridServer("/v", repoRoot, { semantic: true })
  );
  assert.ok(
    argv.some(
      (a, i) => argv[i - 1] === "--env" && a.startsWith("OBSIDIAN_MEMORY_EMBEDDER=fastembed")
    )
  );
  assert.equal(argv[argv.indexOf("--") + 1], "node");
});

test("codexRemoveArgv mirrors add for idempotency", () => {
  assert.deepEqual(codexRemoveArgv("basic-memory"), ["mcp", "remove", "basic-memory"]);
});

test("codexTomlBlock renders a valid config.toml block with escaped Windows paths", () => {
  const block = codexTomlBlock("basic-memory", basicMemoryServer("C:\\Users\\me\\vault"));
  assert.match(block, /^\[mcp_servers\.basic-memory\]/m);
  assert.match(block, /command = "uvx"/);
  assert.match(block, /args = \["--from", "basic-memory==/);
  assert.match(block, /\[mcp_servers\.basic-memory\.env\]/);
  // backslashes doubled for TOML basic strings
  assert.match(block, /BASIC_MEMORY_HOME = "C:\\\\Users\\\\me\\\\vault"/);
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
