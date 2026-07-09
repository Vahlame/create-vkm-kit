import test from "node:test";
import assert from "node:assert/strict";
// Pure module (no MCP import), so `node --test` does not spawn the stdio server.
import { defaultRagTimeoutMs, runRagJsonRaw } from "../src/rag-client.mjs";

test("defaultRagTimeoutMs: falls back to 120000ms when unset", () => {
  delete process.env.OBSIDIAN_MEMORY_RAG_TIMEOUT_MS;
  assert.equal(defaultRagTimeoutMs(), 120_000);
});

test("defaultRagTimeoutMs: reads OBSIDIAN_MEMORY_RAG_TIMEOUT_MS when set", () => {
  process.env.OBSIDIAN_MEMORY_RAG_TIMEOUT_MS = "5000";
  try {
    assert.equal(defaultRagTimeoutMs(), 5000);
  } finally {
    delete process.env.OBSIDIAN_MEMORY_RAG_TIMEOUT_MS;
  }
});

test("defaultRagTimeoutMs: ignores garbage and falls back to the default", () => {
  process.env.OBSIDIAN_MEMORY_RAG_TIMEOUT_MS = "not-a-number";
  try {
    assert.equal(defaultRagTimeoutMs(), 120_000);
  } finally {
    delete process.env.OBSIDIAN_MEMORY_RAG_TIMEOUT_MS;
  }
});

test("runRagJsonRaw: a hung subprocess is killed and rejects with a clear timeout error, not a hang", async () => {
  // Fake "python": a Node one-liner that never exits on its own. Using node -e
  // (Node natively supports -e) instead of the real `-m obsidian_memory_rag`
  // invocation keeps this test fast and dependency-free while still exercising
  // real process spawn + kill + reject:false plumbing in runRagJsonRaw.
  const start = Date.now();
  await assert.rejects(
    () =>
      runRagJsonRaw(process.execPath, ["-e", "setTimeout(() => {}, 999999)"], {
        timeoutMs: 300
      }),
    /timed out after 300ms/
  );
  const elapsed = Date.now() - start;
  // Must resolve promptly (bounded by the timeout), not hang the test suite.
  assert.ok(elapsed < 5000, `expected the timeout to fire quickly, took ${elapsed}ms`);
});

test("runRagJsonRaw: a fast, well-behaved subprocess is unaffected by the timeout", async () => {
  const data = await runRagJsonRaw(
    process.execPath,
    ["-e", "process.stdout.write(JSON.stringify({ok: true}))"],
    { timeoutMs: 5000 }
  );
  assert.deepEqual(data, { ok: true });
});

test("runRagJsonRaw: non-zero exit surfaces stderr, not a timeout error", async () => {
  await assert.rejects(
    () =>
      runRagJsonRaw(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(3)"], {
        timeoutMs: 5000
      }),
    /obsidian-memory-rag exited 3/
  );
});
