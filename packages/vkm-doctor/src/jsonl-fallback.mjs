// Transcript-estimate fallback (ADR-0044): best-effort token counts scanned from Claude
// Code session transcripts (`~/.claude/projects/<slug>/*.jsonl`) for sessions the OTLP sink
// didn't capture (predates install, sink down). The official docs mark this format as
// internal and unstable — every figure produced here is labeled `source:
// "transcript-estimate"` and vkm-doctor never blends it silently with OTEL data.
//
// Reuses the incremental fold engine the kit's transcript hooks already use
// (`getIncrementalState`: offset cache, stale detection, partial-line safety, fail-open)
// with its own cache key so repeated doctor runs only read appended bytes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getIncrementalState } from "@vkmikc/create-vkm-kit/src/hooks/_transcript-cache.mjs";

const CACHE_KEY = "token-doctor";

function initialState() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, turns: 0 };
}

/** Fold one transcript JSONL line: assistant turns carry a `message.usage` block. */
function foldLine(state, line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return state;
  }
  const usage = entry?.message?.usage;
  if (entry?.type !== "assistant" || !usage || typeof usage !== "object") return state;
  state.input += Number(usage.input_tokens) || 0;
  state.output += Number(usage.output_tokens) || 0;
  state.cacheRead += Number(usage.cache_read_input_tokens) || 0;
  state.cacheCreation += Number(usage.cache_creation_input_tokens) || 0;
  state.turns += 1;
  return state;
}

/**
 * Scan every transcript under `projectsDir`, newest-modified first, up to `maxFiles`.
 * @param {{ projectsDir?: string, maxFiles?: number }} [opts]
 * @returns {{ totals: ReturnType<typeof initialState>, files: number, source: string }}
 */
export function scanTranscripts({
  projectsDir = path.join(os.homedir(), ".claude", "projects"),
  maxFiles = 200
} = {}) {
  const totals = initialState();
  let files = 0;
  let candidates = [];
  try {
    for (const slug of fs.readdirSync(projectsDir)) {
      const dir = path.join(projectsDir, slug);
      let names = [];
      try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const name of names) {
        const fp = path.join(dir, name);
        try {
          candidates.push({ fp, mtime: fs.statSync(fp).mtimeMs });
        } catch {
          // ignore races
        }
      }
    }
  } catch {
    return { totals, files: 0, source: "transcript-estimate" };
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const { fp } of candidates.slice(0, maxFiles)) {
    const state = getIncrementalState(fp, CACHE_KEY, initialState, foldLine);
    for (const key of Object.keys(totals)) totals[key] += state[key] || 0;
    files += 1;
  }
  return { totals, files, source: "transcript-estimate" };
}
