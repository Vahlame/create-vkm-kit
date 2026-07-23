/**
 * Disk durability for the package's in-memory TTL caches (serp.mjs's search cache, research.mjs's
 * SearXNG + fetch caches) — an opt-in enhancement, never a dependency, same contract as
 * `dedupe_similar`/`diversify`/`persist` elsewhere in this package: unset `OBSCURA_CACHE_DIR` and
 * every cache behaves exactly as it did before this module existed (in-memory only, gone on
 * restart). Set it and a restarted MCP server starts warm instead of cold, and — combined with
 * each cache's own "serve the stale entry instead of failing" fallback at its call site — a
 * network-down agent still gets its last-known answer instead of a hard error. This module only
 * does the disk I/O; deciding what's stale-serveable and when stays with each cache's own TTL
 * logic (it already tracks `at`/eviction/banned-vs-exhausted rules this module has no business
 * reimplementing).
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

/** Empty string (never touch disk) unless the operator opted in. */
export function cacheDir() {
  return process.env.OBSCURA_CACHE_DIR || "";
}

/** `path.join(cacheDir(), name)`, or `null` when disk persistence is off — callers gate every
 * load/save on this being non-null rather than re-reading the env var themselves. */
export function cacheFilePath(name) {
  const dir = cacheDir();
  return dir ? path.join(dir, name) : null;
}

/**
 * Load a JSON object of `{ key: { at, ...value } }` entries from `filePath`. A missing file,
 * unreadable file, or corrupt JSON all degrade to "start cold" (`{}`) — this is a cache, and a
 * cache that can't be read is exactly equivalent to an empty one, never a reason to crash startup.
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
export function loadCacheFile(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Persist a Map's entries to `filePath` as JSON, atomically: write to a sibling temp file, then
 * rename — a process killed mid-write can never leave a half-written (unparsable) cache file
 * behind, since `rename` is the only step that makes the new content visible at `filePath`.
 * Creates the parent directory if missing. Never throws: a failed write degrades to "this entry
 * doesn't survive a restart", the same as disk persistence being off, not a broken tool call.
 * @param {string} filePath
 * @param {Map<string, unknown>} map
 */
export function saveCacheFile(filePath, map) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)));
    renameSync(tmp, filePath);
  } catch {
    /* best-effort — an in-memory-only cache for the rest of this process still works fine */
  }
}
