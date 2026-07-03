import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ragSrc = path.join(root, "packages", "obsidian-memory-rag", "src");
const py = process.platform === "win32" ? "python" : "python3";

test("python json-search returns JSON (monorepo PYTHONPATH)", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hybrid-json-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  fs.writeFileSync(path.join(vault, "n.md"), "# T\nhello uniquehybridtoken xyz\n", "utf8");
  const env = { ...process.env, PYTHONPATH: ragSrc };
  const r1 = spawnSync(py, ["-m", "obsidian_memory_rag", "json-index", "--vault", vault], {
    encoding: "utf8",
    env
  });
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = spawnSync(
    py,
    [
      "-m",
      "obsidian_memory_rag",
      "json-search",
      "--vault",
      vault,
      "--query",
      "uniquehybridtoken",
      "--limit",
      "5"
    ],
    { encoding: "utf8", env }
  );
  assert.equal(r2.status, 0, r2.stderr);
  const data = JSON.parse(r2.stdout);
  assert.equal(data.count, 1);
  assert.equal(data.hits[0].path, "n.md");
  // Compact wire contract (ADR-0034): diagnostics only ship under --explain.
  assert.ok(!("bm25" in data.hits[0]), "default hit must omit bm25");
  assert.ok(!("mtime_ns" in data.hits[0]), "default hit must omit mtime_ns");
  const r3 = spawnSync(
    py,
    [
      "-m",
      "obsidian_memory_rag",
      "json-search",
      "--vault",
      vault,
      "--query",
      "uniquehybridtoken",
      "--limit",
      "5",
      "--explain"
    ],
    { encoding: "utf8", env }
  );
  assert.equal(r3.status, 0, r3.stderr);
  const explained = JSON.parse(r3.stdout);
  assert.ok("bm25" in explained.hits[0], "--explain must include bm25");
  assert.ok("mtime_ns" in explained.hits[0], "--explain must include mtime_ns");
});

test("python json-hybrid-search returns fused JSON after semantic index", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hybrid-vec-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  fs.writeFileSync(
    path.join(vault, "deploy.md"),
    "# Deploy guide\nShipping the service to production with zero downtime\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(vault, "food.md"),
    "# Breakfast\nBananas and pancakes and coffee\n",
    "utf8"
  );
  const env = { ...process.env, PYTHONPATH: ragSrc };
  const r1 = spawnSync(
    py,
    ["-m", "obsidian_memory_rag", "json-index", "--vault", vault, "--semantic"],
    { encoding: "utf8", env }
  );
  assert.equal(r1.status, 0, r1.stderr);
  const idx = JSON.parse(r1.stdout);
  assert.equal(idx.vectors.embedded, 2);
  const r2 = spawnSync(
    py,
    [
      "-m",
      "obsidian_memory_rag",
      "json-hybrid-search",
      "--vault",
      vault,
      "--query",
      "production deployment downtime",
      "--limit",
      "5"
    ],
    { encoding: "utf8", env }
  );
  assert.equal(r2.status, 0, r2.stderr);
  const data = JSON.parse(r2.stdout);
  assert.ok(data.count >= 1);
  assert.equal(data.hits[0].path, "deploy.md");
  // Compact wire contract (ADR-0034): the agent-facing default carries only
  // path/heading/snippet + a 5-decimal score; per-ranker diagnostics (mostly
  // null, ~20 tokens/hit) require --explain.
  const hit = data.hits[0];
  assert.ok(!("bm25_rank" in hit), "default hit must omit bm25_rank");
  assert.ok(!("vector_rank" in hit), "default hit must omit vector_rank");
  assert.ok(!("graph_rank" in hit), "default hit must omit graph_rank");
  assert.ok(!("rerank_score" in hit), "default hit must omit rerank_score");
  assert.equal(hit.score, Number(hit.score.toFixed(5)), "score must be rounded to 5 decimals");
  const r3 = spawnSync(
    py,
    [
      "-m",
      "obsidian_memory_rag",
      "json-hybrid-search",
      "--vault",
      vault,
      "--query",
      "production deployment downtime",
      "--limit",
      "5",
      "--explain"
    ],
    { encoding: "utf8", env }
  );
  assert.equal(r3.status, 0, r3.stderr);
  const explained = JSON.parse(r3.stdout);
  for (const key of ["score_raw", "bm25_rank", "vector_rank", "graph_rank", "rerank_score"]) {
    assert.ok(key in explained.hits[0], `--explain must include ${key}`);
  }
});
