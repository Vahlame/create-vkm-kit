import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { draftSpec, ensureOllamaServer, DEFAULT_KEEP_ALIVE } from "../src/ollama-client.mjs";

/** Fake Ollama that captures the /api/chat request body (resource-policy assertions). */
function fakeOllama() {
  let captured = null;
  const spec = {
    systemRole: "You are a test engineer.",
    userIntent: "verify keep_alive is sent",
    functionalRequirements: ["req one", "req two", "req three"],
    constraints: [],
    currentStateSummary: "test state"
  };
  const server = http.createServer((req, res) => {
    if (req.url === "/api/version") {
      res.end(JSON.stringify({ version: "0.9.9" }));
      return;
    }
    if (req.url === "/api/tags") {
      res.end(JSON.stringify({ models: [{ name: "phi4-mini:3.8b-q4_K_M" }] }));
      return;
    }
    if (req.url === "/api/chat") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        captured = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.setHeader("content-type", "application/x-ndjson");
        res.write(
          JSON.stringify({ message: { content: JSON.stringify(spec) }, done: false }) + "\n"
        );
        res.end(JSON.stringify({ done: true }) + "\n");
      });
      return;
    }
    res.writeHead(404).end();
  });
  return { server, getCaptured: () => captured };
}

test("draftSpec sends keep_alive (default 2m) so the model unloads and frees RAM", async () => {
  const { server, getCaptured } = fakeOllama();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `http://127.0.0.1:${server.address().port}`;
  try {
    const { source } = await draftSpec({ idea: "x", context: "", host });
    assert.equal(source, "ollama");
    assert.equal(getCaptured().keep_alive, DEFAULT_KEEP_ALIVE);
  } finally {
    server.close();
  }
});

test("draftSpec honors an explicit keepAlive override", async () => {
  const { server, getCaptured } = fakeOllama();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `http://127.0.0.1:${server.address().port}`;
  try {
    await draftSpec({ idea: "x", context: "", host, keepAlive: "0" });
    assert.equal(getCaptured().keep_alive, "0");
  } finally {
    server.close();
  }
});

test("ensureOllamaServer never spawns for a custom (user-managed) host", async () => {
  const started = Date.now();
  const up = await ensureOllamaServer({ host: "http://127.0.0.1:1" });
  assert.equal(up, false);
  assert.ok(Date.now() - started < 1000, "must return immediately, no spawn/poll");
});
