/**
 * Append-only audit log of every download, so the user can see after the fact what was fetched and
 * where it landed. One JSON object per line at ~/.vkm/downloads/downloads.log (override with
 * VKM_DOWNLOAD_LOG). Bounded: trimmed to the last MAX_LINES once it grows past MAX_BYTES.
 *
 * Mirrors obscura-web's search-log.mjs — same shape, same "never throws" contract.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_BYTES = 512 * 1024;
const MAX_LINES = 500;

export function downloadLogPath() {
  return process.env.VKM_DOWNLOAD_LOG || join(homedir(), ".vkm", "downloads", "downloads.log");
}

/** Record one download. Never throws — an audit-log failure must not break a completed download. */
export function logDownload(entry) {
  try {
    const p = downloadLogPath();
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
    if (statSync(p).size > MAX_BYTES) {
      const kept = readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-MAX_LINES);
      writeFileSync(p, kept.join("\n") + "\n");
    }
  } catch {
    /* best-effort: a logging failure must never break a download */
  }
}
