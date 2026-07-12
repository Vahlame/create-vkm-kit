/**
 * Append-only log of obscura_search queries so the SearXNG monitor GUI can show "what was searched".
 * One JSON object per line at ~/.vkm/searxng/searches.log (override with OBSCURA_SEARXNG_LOG).
 * Bounded: trimmed to the last MAX_LINES once it grows past MAX_BYTES.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_BYTES = 512 * 1024;
const MAX_LINES = 300;

export function searchLogPath() {
  return process.env.OBSCURA_SEARXNG_LOG || join(homedir(), ".vkm", "searxng", "searches.log");
}

/** Record one search. Never throws — logging must not break a search. */
export function logSearch(query, source, count) {
  try {
    const p = searchLogPath();
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(
      p,
      JSON.stringify({ ts: new Date().toISOString(), query, source, count }) + "\n"
    );
    if (statSync(p).size > MAX_BYTES) {
      const kept = readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-MAX_LINES);
      writeFileSync(p, kept.join("\n") + "\n");
    }
  } catch {
    /* best-effort: a logging failure must never break a search */
  }
}
