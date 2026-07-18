/**
 * `expandQuery` (ADR-0057) — the stage that decides whether the answer is ever crawled at all.
 *
 * These tests pin the CONTRACT (shape, dedup, budget, degradation), not the model's judgment.
 * Expansion quality is a model property and belongs to the bench, not to a unit test: a fake
 * Ollama returning canned JSON cannot tell you whether a 3.8B actually knows that "hidden
 * instructions on a page" is called prompt injection. Measured, it often does not — see
 * evals/research and the ADR. What IS testable here is that the plumbing around the model
 * never makes things worse: never drops the asker's own wording, never spends a SearXNG
 * round-trip on a duplicate, never lets a schema violation take the whole research call down.
 */

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  DEFAULT_EXPAND_MODEL,
  OllamaUnavailableError,
  expandQuery
} from "../src/ollama-client.mjs";

/** Minimal fake Ollama (non-streaming `/api/chat`, matching expandQuery's `stream: false`).
 * Serves DEFAULT_EXPAND_MODEL, not DEFAULT_MODEL: expansion deliberately runs on a different,
 * more capable model than curation — a 3.8B can read a page but cannot recall that "hidden
 * instructions on a page" is called prompt injection (measured: +0 answers found, 2x the junk). */
function startFakeOllama({
  version = "0.6.0",
  models = [{ name: DEFAULT_EXPAND_MODEL }],
  chatContent = JSON.stringify({ concept: "c", queries: [] }),
  onChat = null
} = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/chat") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (onChat) onChat(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: DEFAULT_EXPAND_MODEL,
            message: { role: "assistant", content: chatContent },
            done: true
          })
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        host: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

test("expandQuery keeps the original query first and appends the expansions", async () => {
  // The original is never replaced, only prefixed: if the asker already knew the exact term,
  // their wording is the best query available and a 3.8B model is no reason to discard it.
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({
      concept: "prompt injection",
      queries: ["indirect prompt injection mitigation", "OWASP LLM01"]
    })
  });
  try {
    const r = await expandQuery({ query: "hidden instructions on a page", host: fake.host });
    assert.equal(r.concept, "prompt injection");
    assert.deepEqual(r.queries, [
      "hidden instructions on a page",
      "indirect prompt injection mitigation",
      "OWASP LLM01"
    ]);
  } finally {
    await fake.close();
  }
});

test("expandQuery dedupes case-insensitively, including against the original", async () => {
  // A small model asked for N angles will happily repeat itself, and every duplicate costs a
  // real SearXNG round-trip (which fans out to ~108 upstream engines) for zero new candidates.
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({
      concept: "c",
      queries: [
        "Write Lock Contention",
        "write lock contention",
        "SQLITE_BUSY",
        "sqlite busy pragma"
      ]
    })
  });
  try {
    const r = await expandQuery({ query: "write lock contention", host: fake.host });
    assert.deepEqual(r.queries, ["write lock contention", "SQLITE_BUSY", "sqlite busy pragma"]);
  } finally {
    await fake.close();
  }
});

test("expandQuery honours `max` — the fan-out budget, not a style preference", async () => {
  // Each sub-query is a SearXNG round-trip that fans out to ~108 upstream engines, so this cap
  // is politeness and latency, not tidiness.
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({ concept: "c", queries: ["a", "b", "c", "d", "e", "f", "g"] })
  });
  try {
    const r = await expandQuery({ query: "orig", host: fake.host, max: 3 });
    assert.deepEqual(r.queries, ["orig", "a", "b"]);
  } finally {
    await fake.close();
  }
});

test("expandQuery drops blanks and leaked sentences", async () => {
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({
      concept: "c",
      queries: ["", "   ", "valid query", "x".repeat(250)]
    })
  });
  try {
    const r = await expandQuery({ query: "orig", host: fake.host });
    assert.deepEqual(r.queries, ["orig", "valid query"]);
  } finally {
    await fake.close();
  }
});

test("expandQuery tolerates a model that returns no expansions at all", async () => {
  // Degrading to just the original is the floor: a crawl no wider than before, never a crash.
  const fake = await startFakeOllama({ chatContent: JSON.stringify({ concept: "", queries: [] }) });
  try {
    const r = await expandQuery({ query: "orig", host: fake.host });
    assert.deepEqual(r.queries, ["orig"]);
  } finally {
    await fake.close();
  }
});

test("expandQuery throws OllamaUnavailableError on a schema-violating response", async () => {
  const fake = await startFakeOllama({ chatContent: JSON.stringify({ queries: "not an array" }) });
  try {
    await assert.rejects(
      () => expandQuery({ query: "orig", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "schema_reject"
    );
  } finally {
    await fake.close();
  }
});

test("expandQuery asks for max-1 expansions (the original occupies one slot)", async () => {
  let seen = null;
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({ concept: "c", queries: [] }),
    onChat: (body) => {
      seen = body;
    }
  });
  try {
    await expandQuery({ query: "orig", host: fake.host, max: 6 });
    assert.match(seen.messages.at(-1).content, /at most 5 queries/);
    assert.equal(seen.stream, false);
    assert.ok(seen.format, "constrained decoding via the JSON schema, not prose parsing");
  } finally {
    await fake.close();
  }
});

test("expandQuery on an empty query is a no-op that never dials the model", async () => {
  // Port 1 is not listening: reaching the network here would throw, so returning cleanly proves
  // the short-circuit.
  const r = await expandQuery({ query: "   ", host: "http://127.0.0.1:1" });
  assert.deepEqual(r, { concept: "", queries: [] });
});

test("expandQuery refuses when its model is not pulled — degrading is the CORRECT outcome", async () => {
  // A host that only has the curation model must NOT expand. This is not a consolation
  // fallback: measured on evals/research, expansion via phi4-mini found +0 extra answers and
  // doubled the social-media junk in the pool, so expanding with it is worse than not expanding.
  // `deepResearch` catches this and crawls the original query alone, which is the right crawl.
  const fake = await startFakeOllama({ models: [{ name: "phi4-mini:3.8b-q4_K_M" }] });
  try {
    await assert.rejects(
      () => expandQuery({ query: "orig", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "model_missing"
    );
  } finally {
    await fake.close();
  }
});

test("expandQuery sends think:false — reasoning models otherwise return empty content", async () => {
  // Measured on qwen3.5:4b-q4_K_M: with thinking on, 3 of 4 calls came back with an EMPTY
  // message.content ("Unexpected end of JSON input") and the one that answered took 40s vs
  // phi4-mini's ~1s. The model spends its budget in `message.thinking`, a field this client
  // never reads. With think:false: 1.4s, zero failures.
  let seen = null;
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({ concept: "c", queries: [] }),
    onChat: (body) => {
      seen = body;
    }
  });
  try {
    await expandQuery({ query: "orig", host: fake.host });
    assert.equal(seen.think, false);
  } finally {
    await fake.close();
  }
});
