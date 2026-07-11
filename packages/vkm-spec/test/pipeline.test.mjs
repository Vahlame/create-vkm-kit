/**
 * End-to-end pipeline over a REAL tiny fixture vault. Like hybrid-mcp.test.mjs, this drives
 * the Python `obsidian-memory-rag` bridge (auto-indexes on first query), so it needs python
 * + the rag package importable — both present in this environment. The `llm:false` path is
 * pure/deterministic (no network); a second case points the LLM at a closed port to prove
 * the graceful-degradation contract at the pipeline level.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSpec } from "../src/pipeline.mjs";

function makeFixtureVault() {
  const vault = mkdtempSync(join(tmpdir(), "vkm-spec-vault-"));
  mkdirSync(join(vault, ".obsidian"));
  mkdirSync(join(vault, "PROJECTS"));
  writeFileSync(
    join(vault, "PROJECTS", "demo-app.md"),
    [
      "# demo-app",
      "",
      "- [decision] demo-app uses websocket reconnect with exponential backoff #arch",
      "- [gotcha] demo-app dev server drops idle connections after 60s #infra",
      ""
    ].join("\n"),
    "utf8"
  );
  return vault;
}

function withVault(vault, fn) {
  const prev = process.env.BASIC_MEMORY_HOME;
  process.env.BASIC_MEMORY_HOME = vault;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env.BASIC_MEMORY_HOME;
      else process.env.BASIC_MEMORY_HOME = prev;
    });
}

function closedPortHost() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(`http://127.0.0.1:${port}`));
    });
  });
}

test("buildSpec (llm:false) compiles a working xml with vault context, source:'fallback'", async () => {
  const vault = makeFixtureVault();
  try {
    await withVault(vault, async () => {
      const idea = "add websocket reconnect handling";
      const result = await buildSpec({ idea, project: "demo-app", lang: "en", llm: false });

      assert.equal(result.source, "fallback");
      assert.equal(result.spec.userIntent, idea);
      assert.match(result.xml, /<orchestration_package>/);
      assert.match(result.xml, /<\/orchestration_package>/);
      assert.equal(result.backendError, null, "python rag bridge must run in this env");
      assert.ok(
        result.context.historicalDecisions.some((d) => d.includes("reconnect")),
        "the typed [decision] must land in historicalDecisions"
      );
      // The compiled XML carries the retrieved decision, not the empty-history fallback copy.
      assert.match(result.xml, /reconnect/);
    });
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("buildSpec (llm:true) degrades to deterministic fallback when Ollama is unreachable", async () => {
  const vault = makeFixtureVault();
  const host = await closedPortHost();
  try {
    await withVault(vault, async () => {
      const idea = "add websocket reconnect handling";
      const result = await buildSpec({
        idea,
        project: "demo-app",
        lang: "en",
        llm: true,
        ollamaHost: host
      });
      assert.equal(result.source, "fallback");
      assert.ok(result.ollamaError, "the Ollama failure reason must be surfaced");
      assert.ok(result.xml.length > 0, "fallback still produces a non-empty xml");
      assert.equal(result.spec.userIntent, idea);
    });
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
