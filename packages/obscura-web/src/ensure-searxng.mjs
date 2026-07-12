/**
 * On-demand lifecycle for the local SearXNG that backs obscura_search.
 *
 * SearXNG is NOT kept running: ensureSearxng() starts it lazily on the first search and an idle
 * timer stops it after OBSCURA_SEARXNG_IDLE_MS with no further searches — it costs nothing while the
 * agent isn't searching. The spawned server is bound to this process (killed on exit). When it can't
 * be started (no local install, autostart disabled), ensureSearxng() returns null and the caller
 * falls back to SERP scraping. An externally-run instance (e.g. start.ps1) is used but never killed.
 *
 * Local layout is created by packages/obscura-web/searxng/README.md; each path is overridable:
 *   OBSCURA_SEARXNG_PORT       default 8888
 *   OBSCURA_SEARXNG_PY         venv python      (~/.vkm/searxng-venv/Scripts/python.exe)
 *   OBSCURA_SEARXNG_SRC        searxng checkout (~/.vkm/searxng-src)
 *   OBSCURA_SEARXNG_SETTINGS   settings.yml     (~/.vkm/searxng/settings.yml)
 *   OBSCURA_SEARXNG_IDLE_MS    idle shutdown ms (default 90000)
 *   OBSCURA_SEARXNG_AUTOSTART=0  never spawn — only use an already-running instance
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function cfg() {
  const home = homedir();
  const port = Number(process.env.OBSCURA_SEARXNG_PORT) || 8888;
  return {
    base: `http://127.0.0.1:${port}`,
    py:
      process.env.OBSCURA_SEARXNG_PY || join(home, ".vkm", "searxng-venv", "Scripts", "python.exe"),
    src: process.env.OBSCURA_SEARXNG_SRC || join(home, ".vkm", "searxng-src"),
    settings: process.env.OBSCURA_SEARXNG_SETTINGS || join(home, ".vkm", "searxng", "settings.yml"),
    idleMs: Number(process.env.OBSCURA_SEARXNG_IDLE_MS) || 90000,
    autostart: process.env.OBSCURA_SEARXNG_AUTOSTART !== "0"
  };
}

let child = null; // the SearXNG process WE own (an external one stays null and is never killed)
let idleTimer = null;
let starting = null; // in-flight start promise (dedupe concurrent searches)
let exitHooked = false;

/** True if something answers HTTP on `base` — liveness, not readiness. */
async function isUp(base, fetchImpl, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetchImpl(`${base}/`, { signal: ctrl.signal, redirect: "manual" });
    return true; // any HTTP response (even 3xx/4xx) means the port is serving
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** True once a JSON search actually works (engines loaded — stricter than isUp). */
async function isReady(base, fetchImpl, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/search?q=ok&format=json`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "X-Forwarded-For": "127.0.0.1" }
    });
    if (!res.ok) return false;
    await res.json();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function armIdleTimer(idleMs) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(stopSearxng, idleMs);
  if (typeof idleTimer.unref === "function") idleTimer.unref(); // never keep the process alive for this
}

/** Stop the SearXNG we started (no-op for an external instance) and cancel idle shutdown. */
export function stopSearxng() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (child && child.exitCode === null) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  child = null;
}

function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.once("exit", stopSearxng);
  // Defer the hard exit one tick after kill(): on Windows, exiting in the same tick a child handle
  // is closing trips a libuv assertion (UV_HANDLE_CLOSING). setImmediate lets the handle finish.
  for (const [sig, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143]
  ]) {
    process.once(sig, () => {
      stopSearxng();
      setImmediate(() => process.exit(code));
    });
  }
}

/**
 * Ensure a local SearXNG is reachable, starting it on demand and scheduling idle shutdown.
 * @param {{ fetchImpl?: typeof fetch, spawnImpl?: typeof spawn }} [deps] injectable for tests
 * @returns {Promise<string|null>} base URL if usable, else null (caller falls back to scraping)
 */
export async function ensureSearxng(deps = {}) {
  const { fetchImpl = fetch, spawnImpl = spawn } = deps;
  const c = cfg();

  // Already serving (ours or external)? Use it; (re)arm idle shutdown only for one we own.
  if (await isUp(c.base, fetchImpl)) {
    if (child) armIdleTimer(c.idleMs);
    return c.base;
  }
  if (!c.autostart || !existsSync(c.py) || !existsSync(c.src)) return null;

  if (starting) return starting; // a concurrent search is already booting it
  starting = (async () => {
    hookExit();
    child = spawnImpl(c.py, ["-m", "searx.webapp"], {
      cwd: c.src,
      env: { ...process.env, SEARXNG_SETTINGS_PATH: c.settings },
      stdio: "ignore",
      windowsHide: true
    });
    child.once("exit", () => {
      child = null;
    });
    if (typeof child.unref === "function") child.unref(); // the server must not keep the MCP loop alive
    const deadline = Date.now() + 20000; // engines load a few seconds after the port opens
    while (Date.now() < deadline) {
      if (await isReady(c.base, fetchImpl)) {
        armIdleTimer(c.idleMs);
        return c.base;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    stopSearxng(); // never came up in time — don't leave a zombie
    return null;
  })().finally(() => {
    starting = null;
  });
  return starting;
}
