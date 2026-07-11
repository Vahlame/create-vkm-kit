import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  checkOllama,
  draftSpec,
  compareVersions,
  OllamaUnavailableError,
  DEFAULT_MODEL
} from "../src/ollama-client.mjs";

const VALID_SPEC = {
  systemRole: "You are a senior engineer.",
  userIntent: "Add a retry with exponential backoff to the HTTP client.",
  functionalRequirements: [
    "Retry idempotent requests up to 3 times",
    "Back off exponentially with jitter",
    "Surface the final error after exhaustion"
  ],
  constraints: [],
  currentStateSummary: "Client is a thin fetch wrapper with no retry today."
};

/**
 * Minimal fake Ollama. Options:
 *  - version: string for GET /api/version
 *  - models: array of {name} for GET /api/tags
 *  - chatContent: the full string the /api/chat stream should accumulate to (split in 3)
 *  - chatStatus: override HTTP status for /api/chat (e.g. 404)
 */
function startFakeOllama({
  version = "0.6.0",
  models = [{ name: DEFAULT_MODEL }],
  chatContent = JSON.stringify(VALID_SPEC),
  chatStatus = 200
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
      req.on("data", () => {});
      req.on("end", () => {
        if (chatStatus !== 200) {
          res.writeHead(chatStatus, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "boom" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        // Split the content into three chunks so onProgress sees multiple ticks.
        const n = Math.max(1, Math.floor(chatContent.length / 3));
        const parts = [
          chatContent.slice(0, n),
          chatContent.slice(n, 2 * n),
          chatContent.slice(2 * n)
        ];
        for (const part of parts) {
          res.write(
            JSON.stringify({ message: { role: "assistant", content: part }, done: false }) + "\n"
          );
        }
        res.write(JSON.stringify({ message: { content: "" }, done: true }) + "\n");
        res.end();
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

/** A definitely-closed port: open a server, grab its port, close it. */
function closedPortHost() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(`http://127.0.0.1:${port}`));
    });
  });
}

test("compareVersions handles numeric fields and pre-release suffixes", () => {
  assert.equal(compareVersions("0.6.0", "0.5.13"), 1);
  assert.equal(compareVersions("0.5.13", "0.5.13"), 0);
  assert.equal(compareVersions("0.4.0", "0.5.13"), -1);
  assert.equal(compareVersions("0.5.13-rc1", "0.5.13"), 0);
  assert.equal(compareVersions("1.0", "0.9.9"), 1);
});

test("checkOllama reports ok + version + model presence against a live fake", async () => {
  const fake = await startFakeOllama({ version: "0.6.0" });
  try {
    const status = await checkOllama({ host: fake.host, model: DEFAULT_MODEL });
    assert.equal(status.ok, true);
    assert.equal(status.version, "0.6.0");
    assert.equal(status.hasModel, true);
  } finally {
    await fake.close();
  }
});

test("checkOllama: version below the minimum is not ok", async () => {
  const fake = await startFakeOllama({ version: "0.4.0" });
  try {
    const status = await checkOllama({ host: fake.host });
    assert.equal(status.ok, false);
    assert.equal(status.version, "0.4.0");
  } finally {
    await fake.close();
  }
});

test("draftSpec streams, accumulates, validates, and reports source:'ollama'", async () => {
  const fake = await startFakeOllama();
  try {
    let ticks = 0;
    const { spec, source } = await draftSpec({
      idea: "add retry",
      context: "Client: fetch wrapper",
      host: fake.host,
      onProgress: () => {
        ticks += 1;
      }
    });
    assert.equal(source, "ollama");
    assert.deepEqual(spec, VALID_SPEC);
    assert.ok(ticks >= 1, "onProgress must be called at least once");
  } finally {
    await fake.close();
  }
});

test("draftSpec: closed port -> OllamaUnavailableError (conn_refused)", async () => {
  const host = await closedPortHost();
  await assert.rejects(draftSpec({ idea: "x", context: "", host, timeoutMs: 5000 }), (e) => {
    assert.ok(e instanceof OllamaUnavailableError);
    assert.equal(e.reason, "conn_refused");
    return true;
  });
});

test("draftSpec: version too old -> OllamaUnavailableError (version_too_old)", async () => {
  const fake = await startFakeOllama({ version: "0.4.0" });
  try {
    await assert.rejects(
      draftSpec({ idea: "x", context: "", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "version_too_old"
    );
  } finally {
    await fake.close();
  }
});

test("draftSpec: model not pulled -> OllamaUnavailableError (model_missing)", async () => {
  const fake = await startFakeOllama({ models: [{ name: "some-other-model" }] });
  try {
    await assert.rejects(
      draftSpec({ idea: "x", context: "", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "model_missing"
    );
  } finally {
    await fake.close();
  }
});

test("draftSpec: non-JSON stream content -> OllamaUnavailableError (bad_json)", async () => {
  const fake = await startFakeOllama({ chatContent: "this is not json at all" });
  try {
    await assert.rejects(
      draftSpec({ idea: "x", context: "", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "bad_json"
    );
  } finally {
    await fake.close();
  }
});

test("draftSpec: schema-invalid JSON -> OllamaUnavailableError (schema_reject)", async () => {
  //// Valid JSON, truly malformed shape: requirements not an array (floor still rejects).
  const bad = JSON.stringify({ ...VALID_SPEC, functionalRequirements: "not an array" });
  const fake = await startFakeOllama({ chatContent: bad });
  try {
    await assert.rejects(
      draftSpec({ idea: "x", context: "", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "schema_reject"
    );
  } finally {
    await fake.close();
  }
});
