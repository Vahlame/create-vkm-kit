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

test("ensureOllamaServer never spawns or probes for a custom (user-managed) host", async () => {
  // Proven by behaviour, not by the clock. This used to assert `elapsed < 1000ms`
  // against a closed port — a proxy for "it short-circuited", but one a loaded
  // runner, a GC pause, or a firewall that DROPs instead of RSTs can blow.
  //
  // Pointing it at a REACHABLE fake Ollama is a stronger and fully deterministic
  // check: an implementation that probed would find /api/version answering and
  // return true. Only a real short-circuit can still return false here.
  const { server } = fakeOllama();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(
      await ensureOllamaServer({ host }),
      false,
      "a custom host is user-managed: never spawned, and never probed either"
    );
  } finally {
    server.close();
  }
});
