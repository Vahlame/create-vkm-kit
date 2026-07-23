import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  checkOllama,
  curatePage,
  summarizeNotes,
  embedPassages,
  translateQuery,
  looksNonEnglish,
  compareVersions,
  ensureOllamaServer,
  clearQueryCache,
  OllamaUnavailableError,
  DEFAULT_MODEL,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EXPAND_MODEL,
  DEFAULT_OLLAMA_HOST
} from "../src/ollama-client.mjs";

/**
 * Minimal fake Ollama (non-streaming `/api/chat`, matching `curatePage`'s `stream: false`).
 * Options: version, models ([{name}]), chatContent (the message.content JSON string the
 * `/api/chat` response carries), chatStatus (override HTTP status), embedResponse/embedStatus
 * for `/api/embed` (defaults to one 4-dim vector per input, echoing input.length).
 */
function startFakeOllama({
  version = "0.6.0",
  models = [{ name: DEFAULT_MODEL }, { name: DEFAULT_EMBED_MODEL }],
  chatContent = JSON.stringify({ relevance: 8, reason: "on point", excerpt: "the relevant bit" }),
  chatStatus = 200,
  embedResponse = null,
  embedStatus = 200,
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
      req.on("data", () => {});
      req.on("end", () => {
        if (onChat) onChat();
        if (chatStatus !== 200) {
          res.writeHead(chatStatus, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "boom" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: DEFAULT_MODEL,
            message: { role: "assistant", content: chatContent },
            done: true
          })
        );
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/embed") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (embedStatus !== 200) {
          res.writeHead(embedStatus, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "boom" }));
          return;
        }
        const { input } = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: DEFAULT_EMBED_MODEL,
            embeddings: embedResponse ?? input.map((_, i) => [i, i + 1, i + 2, i + 3])
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

test("checkOllama: closed port never throws, just reports unreachable", async () => {
  const host = await closedPortHost();
  const status = await checkOllama({ host });
  assert.equal(status.ok, false);
  assert.equal(status.version, null);
});

test("curatePage: happy path returns the model's relevant/excerpt verdict", async () => {
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({
      relevance: 7,
      reason: "answers the query",
      excerpt: "a page found the eiffel tower"
    })
  });
  try {
    const out = await curatePage({
      markdown: "Some page content about Paris landmarks.",
      query: "eiffel tower",
      host: fake.host
    });
    assert.equal(out.relevant, true);
    assert.equal(out.excerpt, "a page found the eiffel tower");
    assert.equal(out.truncated, false);
  } finally {
    await fake.close();
  }
});

test("curatePage: reports truncated when the page exceeds maxInputChars", async () => {
  const fake = await startFakeOllama();
  try {
    const out = await curatePage({
      markdown: "x".repeat(20_000),
      query: "anything",
      host: fake.host,
      maxInputChars: 100
    });
    assert.equal(out.truncated, true);
  } finally {
    await fake.close();
  }
});

test("curatePage: closed port -> OllamaUnavailableError (conn_refused)", async () => {
  const host = await closedPortHost();
  await assert.rejects(curatePage({ markdown: "x", query: "q", host, timeoutMs: 5000 }), (e) => {
    assert.ok(e instanceof OllamaUnavailableError);
    assert.equal(e.reason, "conn_refused");
    return true;
  });
});

test("curatePage: version too old -> OllamaUnavailableError (version_too_old)", async () => {
  const fake = await startFakeOllama({ version: "0.4.0" });
  try {
    await assert.rejects(
      curatePage({ markdown: "x", query: "q", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "version_too_old"
    );
  } finally {
    await fake.close();
  }
});

test("curatePage: model not pulled -> OllamaUnavailableError (model_missing)", async () => {
  const fake = await startFakeOllama({ models: [{ name: "some-other-model" }] });
  try {
    await assert.rejects(
      curatePage({ markdown: "x", query: "q", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "model_missing"
    );
  } finally {
    await fake.close();
  }
});

test("curatePage: malformed JSON content -> OllamaUnavailableError (bad_json)", async () => {
  const fake = await startFakeOllama({ chatContent: "not json at all" });
  try {
    await assert.rejects(
      curatePage({ markdown: "x", query: "q", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "bad_json"
    );
  } finally {
    await fake.close();
  }
});

test("curatePage: wrong shape -> OllamaUnavailableError (schema_reject)", async () => {
  const fake = await startFakeOllama({ chatContent: JSON.stringify({ foo: "bar" }) });
  try {
    await assert.rejects(
      curatePage({ markdown: "x", query: "q", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "schema_reject"
    );
  } finally {
    await fake.close();
  }
});

test("curatePage: HTTP error status -> OllamaUnavailableError (http_error)", async () => {
  const fake = await startFakeOllama({ chatStatus: 500 });
  try {
    await assert.rejects(
      curatePage({ markdown: "x", query: "q", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "http_error"
    );
  } finally {
    await fake.close();
  }
});

// ── embedPassages (ADR-0057 fourth phase) ─────────────────────────────────────────────────

test("embedPassages: happy path returns one vector per input, in order", async () => {
  const fake = await startFakeOllama({
    embedResponse: [
      [1, 0, 0],
      [0, 1, 0]
    ]
  });
  try {
    const out = await embedPassages({ texts: ["first", "second"], host: fake.host });
    assert.deepEqual(out, [
      [1, 0, 0],
      [0, 1, 0]
    ]);
  } finally {
    await fake.close();
  }
});

test("embedPassages: empty input returns an empty array without a network call", async () => {
  const host = await closedPortHost(); // would throw on any real call if one were made
  assert.deepEqual(await embedPassages({ texts: [], host }), []);
});

test("embedPassages: closed port -> OllamaUnavailableError (conn_refused)", async () => {
  const host = await closedPortHost();
  await assert.rejects(embedPassages({ texts: ["x"], host, timeoutMs: 5000 }), (e) => {
    assert.ok(e instanceof OllamaUnavailableError);
    assert.equal(e.reason, "conn_refused");
    return true;
  });
});

test("embedPassages: model not pulled -> OllamaUnavailableError (model_missing)", async () => {
  const fake = await startFakeOllama({ models: [{ name: DEFAULT_MODEL }] }); // embed model absent
  try {
    await assert.rejects(
      embedPassages({ texts: ["x"], host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "model_missing"
    );
  } finally {
    await fake.close();
  }
});

test("embedPassages: HTTP error status -> OllamaUnavailableError (http_error)", async () => {
  const fake = await startFakeOllama({ embedStatus: 500 });
  try {
    await assert.rejects(
      embedPassages({ texts: ["x"], host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "http_error"
    );
  } finally {
    await fake.close();
  }
});

test("embedPassages: a mismatched embeddings count -> OllamaUnavailableError (bad_json)", async () => {
  const fake = await startFakeOllama({ embedResponse: [[1, 2, 3]] }); // 1 vector for 2 inputs
  try {
    await assert.rejects(
      embedPassages({ texts: ["a", "b"], host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "bad_json"
    );
  } finally {
    await fake.close();
  }
});

test("summarizeNotes: happy path returns the model's synthesized summary", async () => {
  const fake = await startFakeOllama({
    chatContent: JSON.stringify({ summary: "cats are great" })
  });
  try {
    const out = await summarizeNotes({
      topic: "cats",
      notesText: "note A\n\nnote B",
      host: fake.host
    });
    assert.equal(out.summary, "cats are great");
  } finally {
    await fake.close();
  }
});

test("summarizeNotes: wrong shape -> OllamaUnavailableError (schema_reject)", async () => {
  const fake = await startFakeOllama({ chatContent: JSON.stringify({ foo: "bar" }) });
  try {
    await assert.rejects(
      summarizeNotes({ topic: "cats", notesText: "x", host: fake.host }),
      (e) => e instanceof OllamaUnavailableError && e.reason === "schema_reject"
    );
  } finally {
    await fake.close();
  }
});

test("summarizeNotes: closed port -> OllamaUnavailableError (conn_refused), same as curatePage", async () => {
  const host = await closedPortHost();
  await assert.rejects(
    summarizeNotes({ topic: "cats", notesText: "x", host, timeoutMs: 5000 }),
    (e) => e instanceof OllamaUnavailableError && e.reason === "conn_refused"
  );
});

test("ensureOllamaServer never spawns for a custom (user-managed) host — closed port", async () => {
  const host = await closedPortHost();
  const ok = await ensureOllamaServer({ host, waitMs: 100 });
  assert.equal(ok, false, "a closed custom-host port must not trigger a spawn attempt");
});

test("ensureOllamaServer never spawns for a custom host even when it IS reachable", async () => {
  // Only DEFAULT_OLLAMA_HOST is eligible for ensureOllamaServer's spawn/reuse logic; any
  // other host short-circuits to false unconditionally — the caller is expected to just
  // call checkOllama directly for a user-managed host, never delegate lifecycle to us.
  const fake = await startFakeOllama();
  try {
    const ok = await ensureOllamaServer({ host: fake.host });
    assert.equal(ok, false);
  } finally {
    await fake.close();
  }
});

test("DEFAULT_OLLAMA_HOST matches vkm-spec's default (shares one local daemon)", () => {
  assert.equal(DEFAULT_OLLAMA_HOST, "http://127.0.0.1:11434");
});

// ── looksNonEnglish + translateQuery (obscura_search translation) ──────────────────────────

test("looksNonEnglish: true on non-ASCII or a non-English stopword, false on clean English", () => {
  assert.equal(looksNonEnglish("optimize latency"), false);
  assert.equal(looksNonEnglish("cpu tuning guide"), false);
  assert.equal(looksNonEnglish("optimización"), true, "any non-ASCII letter");
  assert.equal(looksNonEnglish("optimizacion de la cpu"), true, "accent-less Spanish via stopword");
  assert.equal(looksNonEnglish("中文查询"), true, "non-latin script");
  assert.equal(looksNonEnglish(""), false);
});

test("translateQuery: translates a non-English query to English (translated:true)", async () => {
  const fake = await startFakeOllama({
    models: [{ name: DEFAULT_EXPAND_MODEL }],
    chatContent: JSON.stringify({ query: "windows latency optimization" })
  });
  try {
    const out = await translateQuery({
      query: "optimización de latencia en windows",
      host: fake.host
    });
    assert.deepEqual(out, { query: "windows latency optimization", translated: true });
  } finally {
    await fake.close();
  }
});

test("translateQuery: an already-English query comes back verbatim (translated:false)", async () => {
  const fake = await startFakeOllama({
    models: [{ name: DEFAULT_EXPAND_MODEL }],
    chatContent: JSON.stringify({ query: "cpu tuning guide" })
  });
  try {
    const out = await translateQuery({ query: "CPU tuning guide", host: fake.host });
    assert.equal(out.translated, false, "same query (case-insensitive) counts as not translated");
    assert.equal(out.query, "cpu tuning guide");
  } finally {
    await fake.close();
  }
});

test("translateQuery: empty/leaked model output degrades to the original query", async () => {
  const fake = await startFakeOllama({
    models: [{ name: DEFAULT_EXPAND_MODEL }],
    chatContent: JSON.stringify({ query: "" })
  });
  try {
    const out = await translateQuery({ query: "consulta original", host: fake.host });
    assert.deepEqual(out, { query: "consulta original", translated: false });
  } finally {
    await fake.close();
  }
});

test("translateQuery: closed port -> OllamaUnavailableError (conn_refused)", async () => {
  const host = await closedPortHost();
  await assert.rejects(
    translateQuery({ query: "hola mundo", host, timeoutMs: 5000 }),
    (e) => e instanceof OllamaUnavailableError && e.reason === "conn_refused"
  );
});

// ── Query-transform cache (expand-query.test.mjs covers expandQuery's own cache hit/miss) ──

test("translateQuery: repeating the same query never re-dials the model (cache hit)", async () => {
  clearQueryCache();
  let calls = 0;
  const fake = await startFakeOllama({
    models: [{ name: DEFAULT_EXPAND_MODEL }],
    chatContent: JSON.stringify({ query: "cpu tuning guide" }),
    onChat: () => calls++
  });
  try {
    const a = await translateQuery({ query: "guía de optimización de cpu", host: fake.host });
    const b = await translateQuery({ query: "guía de optimización de cpu", host: fake.host });
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
  } finally {
    await fake.close();
  }
});

test("translateQuery: a different query is a cache miss (dials again)", async () => {
  clearQueryCache();
  let calls = 0;
  const fake = await startFakeOllama({
    models: [{ name: DEFAULT_EXPAND_MODEL }],
    chatContent: JSON.stringify({ query: "cpu tuning guide" }),
    onChat: () => calls++
  });
  try {
    await translateQuery({ query: "consulta uno", host: fake.host });
    await translateQuery({ query: "consulta dos", host: fake.host });
    assert.equal(calls, 2);
  } finally {
    await fake.close();
  }
});

test("translateQuery: clearQueryCache forces a fresh call", async () => {
  clearQueryCache();
  let calls = 0;
  const fake = await startFakeOllama({
    models: [{ name: DEFAULT_EXPAND_MODEL }],
    chatContent: JSON.stringify({ query: "cpu tuning guide" }),
    onChat: () => calls++
  });
  try {
    await translateQuery({ query: "misma consulta", host: fake.host });
    clearQueryCache();
    await translateQuery({ query: "misma consulta", host: fake.host });
    assert.equal(calls, 2);
  } finally {
    await fake.close();
  }
});

test("translateQuery: a rejected call (schema_reject) is never cached", async () => {
  clearQueryCache();
  let calls = 0;
  const fake = await startFakeOllama({
    models: [{ name: DEFAULT_EXPAND_MODEL }],
    chatContent: JSON.stringify({ notQuery: "wrong shape" }),
    onChat: () => calls++
  });
  try {
    await assert.rejects(translateQuery({ query: "consulta", host: fake.host }));
    await assert.rejects(translateQuery({ query: "consulta", host: fake.host }));
    assert.equal(calls, 2, "a thrown call must not populate the cache");
  } finally {
    await fake.close();
  }
});
