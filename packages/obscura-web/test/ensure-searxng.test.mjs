/**
 * ensureSearxng lifecycle, driven with injected fetch/spawn so no real SearXNG is touched:
 *  - reuses an already-serving instance without spawning;
 *  - refuses to spawn when autostart is disabled or the local install is missing;
 *  - spawns on demand and resolves once a JSON search is ready, then stopSearxng() kills it.
 *
 * node --test runs each test file in its own process, so mutating OBSCURA_SEARXNG_* env here
 * cannot leak into the other suites.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { ensureSearxng, stopSearxng } from "../src/ensure-searxng.mjs";

const ENV_KEYS = [
  "OBSCURA_SEARXNG_PORT",
  "OBSCURA_SEARXNG_PY",
  "OBSCURA_SEARXNG_SRC",
  "OBSCURA_SEARXNG_SETTINGS",
  "OBSCURA_SEARXNG_IDLE_MS",
  "OBSCURA_SEARXNG_AUTOSTART"
];
function setEnv(vars) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

afterEach(() => {
  stopSearxng();
  for (const k of ENV_KEYS) delete process.env[k];
});

const fakeChild = () => ({
  exitCode: null,
  killed: false,
  once() {},
  kill() {
    this.killed = true;
    this.exitCode = 143;
  }
});

test("reuses an already-serving instance without spawning", async () => {
  setEnv({ OBSCURA_SEARXNG_PORT: "8899" });
  const fetchImpl = async () => ({ ok: true }); // isUp resolves → already up
  const spawnImpl = () => {
    throw new Error("must not spawn when already up");
  };
  const base = await ensureSearxng({ fetchImpl, spawnImpl });
  assert.equal(base, "http://127.0.0.1:8899");
});

test("returns null without spawning when autostart is disabled", async () => {
  setEnv({ OBSCURA_SEARXNG_PORT: "8899", OBSCURA_SEARXNG_AUTOSTART: "0" });
  const fetchImpl = async () => {
    throw new Error("down");
  };
  let spawned = 0;
  const spawnImpl = () => {
    spawned++;
    return fakeChild();
  };
  assert.equal(await ensureSearxng({ fetchImpl, spawnImpl }), null);
  assert.equal(spawned, 0);
});

test("returns null without spawning when the venv python is missing", async () => {
  setEnv({ OBSCURA_SEARXNG_PORT: "8899", OBSCURA_SEARXNG_PY: "C:/nope/python.exe" });
  const fetchImpl = async () => {
    throw new Error("down");
  };
  let spawned = 0;
  const spawnImpl = () => {
    spawned++;
    return fakeChild();
  };
  assert.equal(await ensureSearxng({ fetchImpl, spawnImpl }), null);
  assert.equal(spawned, 0);
});

test("spawns on demand, resolves when a JSON search is ready, and stopSearxng kills it", async () => {
  setEnv({
    OBSCURA_SEARXNG_PORT: "8899",
    OBSCURA_SEARXNG_PY: process.execPath, // an existing binary satisfies existsSync
    OBSCURA_SEARXNG_SRC: process.cwd()
  });
  const fetchImpl = async (url) => {
    if (url.endsWith("/")) throw new Error("down"); // isUp: not up before we spawn
    if (url.includes("/search")) return { ok: true, json: async () => ({ results: [] }) }; // isReady
    throw new Error("unexpected url " + url);
  };
  const children = [];
  const spawnImpl = () => {
    const c = fakeChild();
    children.push(c);
    return c;
  };
  const base = await ensureSearxng({ fetchImpl, spawnImpl });
  assert.equal(base, "http://127.0.0.1:8899");
  assert.equal(children.length, 1, "spawned exactly once");
  stopSearxng();
  assert.equal(children[0].killed, true, "stopSearxng terminates the process we started");
});
