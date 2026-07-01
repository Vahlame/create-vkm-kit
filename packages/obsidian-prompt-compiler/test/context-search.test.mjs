import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchContext } from "../src/context-search.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ragSrc = path.join(root, "packages", "obsidian-memory-rag", "src");
const py = process.platform === "win32" ? "python" : "python3";

/** Build + index a temp vault with a project note (decision + non-decision observation)
 * and a STACKS note tagged #stack. Returns the vault path. Skips (returns null) if the
 * Python backend can't run here. */
function buildIndexedVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-compiler-ctx-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  fs.mkdirSync(path.join(vault, "PROJECTS"));
  fs.mkdirSync(path.join(vault, "STACKS"));
  fs.writeFileSync(
    path.join(vault, "PROJECTS", "demo.md"),
    "# demo\n- [decision] usar SQLite #db\n- [gotcha] el ORM no migra solo en Windows #db\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(vault, "STACKS", "ts.md"),
    "# TS\n- [decision] strict mode #stack\n",
    "utf8"
  );
  const env = { ...process.env, PYTHONPATH: ragSrc };
  const r = spawnSync(py, ["-m", "obsidian_memory_rag", "json-index", "--vault", vault], {
    encoding: "utf8",
    env
  });
  if (r.status !== 0) return null;
  return vault;
}

test("searchContext splits project observations into decisions vs. patterns", async (t) => {
  const vault = buildIndexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  process.env.OBSIDIAN_MEMORY_RAG_SRC = ragSrc;
  try {
    const result = await searchContext({
      vault,
      query: "agregar autenticación",
      projectNote: "PROJECTS/demo.md"
    });
    assert.deepEqual(result.historicalDecisions, ["usar SQLite #db"]);
    assert.ok(result.activePatterns.some((p) => p.includes("gotcha") && p.includes("ORM")));
    assert.equal(result.usedFallback, false);
  } finally {
    delete process.env.OBSIDIAN_MEMORY_RAG_SRC;
  }
});

test("searchContext excludes the project note's own hybrid-search hit (no duplication)", async (t) => {
  const vault = buildIndexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  process.env.OBSIDIAN_MEMORY_RAG_SRC = ragSrc;
  try {
    const result = await searchContext({
      vault,
      query: "demo SQLite ORM",
      projectNote: "PROJECTS/demo.md"
    });
    assert.ok(
      !result.activePatterns.some((p) => p.startsWith("[PROJECTS/demo.md]")),
      "the project note itself must not also show up as a raw hybrid-search passage"
    );
  } finally {
    delete process.env.OBSIDIAN_MEMORY_RAG_SRC;
  }
});

test("searchContext returns empty buckets + usedFallback:true for an unrelated query with no project", async (t) => {
  const vault = buildIndexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  process.env.OBSIDIAN_MEMORY_RAG_SRC = ragSrc;
  try {
    const result = await searchContext({
      vault,
      query: "zzz_totally_unrelated_token_qqq",
      projectNote: null
    });
    assert.deepEqual(result.historicalDecisions, []);
    assert.deepEqual(result.activePatterns, []);
    assert.equal(result.usedFallback, true);
    assert.equal(result.backendError, null);
  } finally {
    delete process.env.OBSIDIAN_MEMORY_RAG_SRC;
  }
});

test("searchContext sets backendError (not just usedFallback) when the Python backend can't run", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-compiler-ctx-broken-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  // Point at a nonexistent Python executable — the same ENOENT shape a broken/orphaned
  // venv produces in production. The caller must be able to tell this apart from "vault
  // has nothing on this topic" (a healthy call that just returns no hits).
  process.env.OBSIDIAN_MEMORY_PYTHON = path.join(os.tmpdir(), `no-such-python-${Date.now()}.exe`);
  try {
    const result = await searchContext({ vault, query: "cualquier cosa", projectNote: null });
    assert.equal(result.usedFallback, true);
    assert.ok(result.backendError, "backendError should carry the underlying failure message");
  } finally {
    delete process.env.OBSIDIAN_MEMORY_PYTHON;
  }
});
