/**
 * Server-level tests. The headline is the CI-pinned degradation invariant: POST /api/draft
 * with Ollama pointed at a closed port must still stream an `error` SSE frame that CARRIES a
 * working deterministic xml (source:"fallback"). Plus a pure SSE frame round-trip and the
 * no-LLM /api/compile + /api/projects paths (which never touch the network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, formatSseEvent, parseSseFrames } from "../src/server.mjs";

function makeVault() {
  const vault = mkdtempSync(join(tmpdir(), "vkm-spec-srv-"));
  mkdirSync(join(vault, ".obsidian"));
  return vault;
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r))
      });
    });
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

test("SSE frame round-trip: formatSseEvent -> parseSseFrames", () => {
  const wire =
    formatSseEvent("progress", { tokens: 3 }) +
    formatSseEvent("done", { source: "ollama", xml: "<x/>" });
  const frames = parseSseFrames(wire);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].event, "progress");
  assert.deepEqual(JSON.parse(frames[0].data), { tokens: 3 });
  assert.equal(frames[1].event, "done");
  assert.deepEqual(JSON.parse(frames[1].data), { source: "ollama", xml: "<x/>" });
});

test("GET /api/projects returns the vault path and an array", async () => {
  const vault = makeVault();
  const { base, close } = await listen(createServer({ vault }));
  try {
    const res = await fetch(`${base}/api/projects`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.vault, vault);
    assert.ok(Array.isArray(data.projects));
  } finally {
    await close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test("POST /api/compile compiles xml from provided context (no LLM, no python)", async () => {
  const vault = makeVault();
  const { base, close } = await listen(createServer({ vault, lang: "en" }));
  try {
    const res = await fetch(`${base}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea: "add a health check endpoint",
        historicalDecisions: ["service uses fastify"],
        activePatterns: ["[gotcha] readiness vs liveness differ"],
        techStack: ["node", "fastify"]
      })
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.match(data.xml, /<orchestration_package>/);
    assert.match(data.xml, /- service uses fastify/);
    assert.ok(data.chars > 0 && data.approxTokens > 0);
  } finally {
    await close();
    rmSync(vault, { recursive: true, force: true });
  }
});

test("DEGRADATION GATE: POST /api/draft with Ollama down still yields fallback xml via an `error` SSE frame", async () => {
  const vault = makeVault();
  const ollamaHost = await closedPortHost();
  const { base, close } = await listen(createServer({ vault, lang: "en", ollamaHost }));
  try {
    const res = await fetch(`${base}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "add a websocket keepalive ping" })
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/event-stream/);

    const frames = parseSseFrames(await res.text());
    const errorFrame = frames.find((f) => f.event === "error");
    assert.ok(errorFrame, "an `error` frame must be emitted when Ollama is unreachable");
    const payload = JSON.parse(errorFrame.data);
    assert.equal(payload.source, "fallback", "the error frame must declare source:'fallback'");
    assert.ok(
      typeof payload.xml === "string" && payload.xml.includes("<orchestration_package>"),
      "the error frame must STILL carry a working deterministic xml"
    );
    assert.ok(payload.xml.length > 0, "fallback xml must be non-empty");
  } finally {
    await close();
    rmSync(vault, { recursive: true, force: true });
  }
});
