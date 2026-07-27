/**
 * The Ollama compatibility floor applies to EVERY endpoint, not just /api/chat.
 *
 * `chatJSON` and `embedPassages` each carried their own copy of the transport, and the
 * copy drifted: the embed path checked `health.version` and `health.hasModel` but never
 * `health.ok` — the `>= MIN_OLLAMA_VERSION` gate. So the same daemon was correctly refused
 * on one endpoint and silently accepted on the other, which is worse than either answer,
 * because the failure then shows up as garbage embeddings rather than as a clear refusal.
 *
 * These drive the real functions against a stubbed `fetch`, so they pin the decision rather
 * than the shape of the code that makes it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_OLLAMA_VERSION,
  OllamaUnavailableError,
  embedPassages
} from "../src/ollama-client.mjs";

const HOST = "http://127.0.0.1:11434";

/**
 * Stub the daemon: `/api/version` reports `version`, `/api/tags` always has the model, and
 * `/api/embed` would succeed. Restores the real fetch on dispose.
 * @param {string} version
 */
function fakeOllama(version) {
  const real = globalThis.fetch;
  let embedCalls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api/version")) {
      return { ok: true, json: async () => ({ version }) };
    }
    if (u.endsWith("/api/tags")) {
      return { ok: true, json: async () => ({ models: [{ name: "embeddinggemma" }] }) };
    }
    if (u.endsWith("/api/embed")) {
      embedCalls++;
      return { ok: true, json: async () => ({ embeddings: [[0.1, 0.2]] }) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  return {
    embedCalls: () => embedCalls,
    [Symbol.dispose]: () => {
      globalThis.fetch = real;
    },
    restore: () => {
      globalThis.fetch = real;
    }
  };
}

test("embedPassages refuses a daemon below MIN_OLLAMA_VERSION", async () => {
  const stub = fakeOllama("0.1.0");
  try {
    await assert.rejects(
      () => embedPassages({ texts: ["hello"], model: "embeddinggemma", host: HOST }),
      (err) => {
        assert.ok(err instanceof OllamaUnavailableError);
        assert.equal(err.reason, "version_too_old");
        assert.match(err.message, new RegExp(MIN_OLLAMA_VERSION.replace(/\./g, "\\.")));
        return true;
      },
      "an under-minimum daemon must be refused on the EMBED path too, not only on /api/chat"
    );
    assert.equal(stub.embedCalls(), 0, "it must refuse before spending a request");
  } finally {
    stub.restore();
  }
});

test("embedPassages proceeds on a daemon at or above the floor", async () => {
  const stub = fakeOllama("9.9.9");
  try {
    const out = await embedPassages({ texts: ["hello"], model: "embeddinggemma", host: HOST });
    assert.deepEqual(out, [[0.1, 0.2]]);
    assert.equal(stub.embedCalls(), 1);
  } finally {
    stub.restore();
  }
});

test("an empty input list short-circuits without touching the network", async () => {
  const stub = fakeOllama("0.1.0"); // would refuse if it got as far as the health check
  try {
    assert.deepEqual(await embedPassages({ texts: [] }), []);
    assert.deepEqual(await embedPassages({ texts: undefined }), []);
  } finally {
    stub.restore();
  }
});

test("a short embeddings array is an error, never silently padded", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api/version")) return { ok: true, json: async () => ({ version: "9.9.9" }) };
    if (u.endsWith("/api/tags")) {
      return { ok: true, json: async () => ({ models: [{ name: "embeddinggemma" }] }) };
    }
    return { ok: true, json: async () => ({ embeddings: [[0.1]] }) }; // one vector, two inputs
  };
  try {
    await assert.rejects(
      () => embedPassages({ texts: ["a", "b"], model: "embeddinggemma", host: HOST }),
      (err) => err instanceof OllamaUnavailableError && err.reason === "bad_json",
      "callers pair vectors with inputs by index; a short array must not reach them"
    );
  } finally {
    globalThis.fetch = real;
  }
});
