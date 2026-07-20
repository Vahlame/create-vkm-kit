/**
 * `generateLeads` (ADR-0057) — proposes the next round's search queries for an ongoing
 * `deepResearch` session, reading the latest findings the way a human researcher decides where
 * to dig next.
 *
 * Same philosophy as `expand-query.test.mjs`: these tests pin the CONTRACT (shape, dedup,
 * budget, degradation), not the model's judgment. A fake Ollama returning canned JSON cannot
 * tell you whether a 3.8B actually proposes GOOD leads — that belongs to the bench
 * (evals/research), not a unit test. What IS testable here is that the plumbing around the
 * model never makes things worse: never re-proposes something already searched, never lets a
 * schema violation take the whole research round down, never spends the frontier budget past
 * `max`.
 */

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  DEFAULT_EXPAND_MODEL,
  OllamaUnavailableError,
  generateLeads
} from "../src/ollama-client.mjs";

/** Minimal fake Ollama (non-streaming `/api/chat`, matching generateLeads' `stream: false`).
 * Serves DEFAULT_EXPAND_MODEL, not DEFAULT_MODEL: like expansion, proposing NEW search
 * directions is a recall task a 3.8B measurably cannot do (ADR-0057). */
function startFakeOllama({
  version = "0.6.0",
  models = [{ name: DEFAULT_EXPAND_MODEL }],
  chatContent = JSON.stringify({ leads: [] }),
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

test("generateLeads returns the model's leads, validated and shaped", async () => {
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({
      leads: [
        { query: "prompt injection mitigations", kind: "subtopic", why: "digs into a finding" },
        { query: "sandboxed tool execution", kind: "related", why: "adjacent unexplored area" },
        { query: "airport security layered defense", kind: "analogy", why: "transfers a pattern" }
      ]
    })
  });
  try {
    const r = await generateLeads({
      objective: "harden the agent against hidden instructions",
      findings: [{ title: "OWASP LLM01", note: "prompt injection is the top LLM risk" }],
      host: fake.host
    });
    assert.deepEqual(r.leads, [
      { query: "prompt injection mitigations", kind: "subtopic", why: "digs into a finding" },
      { query: "sandboxed tool execution", kind: "related", why: "adjacent unexplored area" },
      { query: "airport security layered defense", kind: "analogy", why: "transfers a pattern" }
    ]);
  } finally {
    await fake.close();
  }
});

test("generateLeads dedupes case-insensitively against `done` and among the new leads", async () => {
  // A small model asked for N leads will happily re-propose something already searched, or
  // repeat itself within one batch — each duplicate would cost a real SearXNG round-trip
  // downstream for zero new candidates, exactly the waste expandQuery's own dedup prevents.
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({
      leads: [
        { query: "Already Searched Query", kind: "subtopic", why: "dupes done" },
        { query: "new lead alpha", kind: "related", why: "kept" },
        { query: "New Lead Alpha", kind: "analogy", why: "dupes the one above" },
        { query: "new lead beta", kind: "application", why: "kept" }
      ]
    })
  });
  try {
    const r = await generateLeads({
      objective: "obj",
      findings: [],
      done: ["already searched query", "another one"],
      host: fake.host
    });
    assert.deepEqual(r.leads, [
      { query: "new lead alpha", kind: "related", why: "kept" },
      { query: "new lead beta", kind: "application", why: "kept" }
    ]);
  } finally {
    await fake.close();
  }
});

test("generateLeads drops a leaked-sentence query over 200 chars", async () => {
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({
      leads: [
        { query: "x".repeat(250), kind: "subtopic", why: "too long" },
        { query: "short valid lead", kind: "related", why: "kept" }
      ]
    })
  });
  try {
    const r = await generateLeads({ objective: "obj", findings: [], host: fake.host });
    assert.deepEqual(r.leads, [{ query: "short valid lead", kind: "related", why: "kept" }]);
  } finally {
    await fake.close();
  }
});

test("generateLeads throws OllamaUnavailableError on a schema-violating response", async () => {
  const fake = await startFakeOllama({ chatContent: JSON.stringify({ leads: "not an array" }) });
  try {
    await assert.rejects(
      () => generateLeads({ objective: "obj", findings: [], host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "schema_reject"
    );
  } finally {
    await fake.close();
  }
});

test("generateLeads throws OllamaUnavailableError when a lead's kind is not one of LEAD_KINDS", async () => {
  // `kind` is structural, like curatePage's `relevance` — a value outside the known set is
  // rejected wholesale rather than silently coerced, same as any other schema violation.
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({
      leads: [{ query: "orig idea", kind: "improvement", why: "invented kind" }]
    })
  });
  try {
    await assert.rejects(
      () => generateLeads({ objective: "obj", findings: [], host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "schema_reject"
    );
  } finally {
    await fake.close();
  }
});

test("generateLeads on a blank objective is a no-op that never dials the model", async () => {
  // Port 1 is not listening: reaching the network here would throw, so returning cleanly
  // proves the short-circuit — identical contract to expandQuery on an empty query.
  const r = await generateLeads({
    objective: "   ",
    findings: [{ title: "t", note: "n" }],
    host: "http://127.0.0.1:1"
  });
  assert.deepEqual(r, { leads: [] });
});

test("generateLeads honours `max` — the frontier budget, not a style preference", async () => {
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({
      leads: [
        { query: "lead a", kind: "subtopic", why: "1" },
        { query: "lead b", kind: "related", why: "2" },
        { query: "lead c", kind: "analogy", why: "3" },
        { query: "lead d", kind: "application", why: "4" },
        { query: "lead e", kind: "subtopic", why: "5" }
      ]
    })
  });
  try {
    const r = await generateLeads({ objective: "obj", findings: [], max: 2, host: fake.host });
    assert.deepEqual(r.leads, [
      { query: "lead a", kind: "subtopic", why: "1" },
      { query: "lead b", kind: "related", why: "2" }
    ]);
  } finally {
    await fake.close();
  }
});
