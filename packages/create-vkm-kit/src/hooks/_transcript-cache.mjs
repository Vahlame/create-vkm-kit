#!/usr/bin/env node
/**
 * Shared incremental-scan engine for the transcript-reading hooks (`guard-effort-gate.mjs`,
 * `stop-vault-close-reminder.mjs`). Installed by create-obsidian-memory — the vkm-kit
 * installer — alongside them into `~/.claude/hooks/` — NOT a hook itself (Claude Code never
 * invokes this file directly), just a sibling module the other two import.
 *
 * Why: both hooks re-read + re-parse the ENTIRE JSONL transcript on every single gated tool
 * call. Measured ~75ms on a real 25.8MB/1878-line transcript (41ms read + 34ms parse);
 * `guard-effort-gate` pays this on every substantive Write/Edit/MultiEdit/NotebookEdit, so a
 * long session with dozens of edits accumulates real, worsening latency (ADR-0030/0031
 * explicitly deferred this for v1: "zero extra state to manage"). Since each hook invocation
 * is a FRESH subprocess (no persistent in-memory state possible), this adds a small sidecar
 * cache file in the OS temp dir, keyed by the transcript's own path + which hook is asking,
 * storing the last-consumed byte offset plus the caller's derived accumulator state — so a
 * later invocation only reads+parses the NEW suffix appended since the last call.
 *
 * Correctness over speed on any doubt: a missing, corrupt, or stale (transcript shrank —
 * detected by comparing the cache's recorded size/mtime against the current stat) cache always
 * falls back to a full rescan from byte 0. Size/mtime monotonicity alone cannot catch a
 * transcript that was TRUNCATED AND REPLACED with unrelated content, then appended-to past its
 * original size before the next call — same-or-larger size, same-or-newer mtime, wrong bytes.
 * A content fingerprint (hash of the bytes immediately before the cached offset) closes that
 * gap: it is re-verified against the CURRENT file before trusting a resume, so replaced content
 * always falls back to a full rescan instead of resuming into the middle of unrelated bytes. A
 * trailing PARTIAL line (the transcript is being actively appended to mid-write) is never
 * consumed — only complete lines (ending in `"\n"`) advance the committed offset, so a line can
 * never be parsed truncated or silently dropped. This is a PERFORMANCE change only: the derived
 * state for any given transcript content is byte-for-byte identical to what a full rescan would
 * produce.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/** Test-only instrumentation: how many actual file reads / bytes {@link getIncrementalState}
 * performed since the last reset. Lets tests assert a resumed scan reads LESS than a full
 * one — not just that the final derived state ends up correct. Never consulted by the hooks
 * themselves; purely observational. */
export const _debugStats = { reads: 0, bytesRead: 0 };
export function _resetDebugStats() {
  _debugStats.reads = 0;
  _debugStats.bytesRead = 0;
}

function cacheDir() {
  return path.join(os.tmpdir(), "obsidian-memory-kit-hook-cache");
}

/** One cache file per (transcript, hook) pair — two different hooks scanning the SAME
 * transcript (or the same hook across different sessions/transcripts) never collide. */
function cacheFilePath(transcriptPath, cacheKey) {
  const digest = crypto.createHash("sha1").update(path.resolve(transcriptPath)).digest("hex");
  return path.join(cacheDir(), `${digest}.${cacheKey}.json`);
}

/** How many bytes immediately before the cached offset get hashed into the resume
 * fingerprint. Small enough to be cheap on every gated call; large enough that a
 * transcript replacement is astronomically unlikely to hash-collide by chance. */
const FINGERPRINT_WINDOW = 64;

/** Hash of the up-to-{@link FINGERPRINT_WINDOW} bytes immediately before `offset` in
 * `transcriptPath`, as currently on disk. `null` if that region can't be read (missing
 * file, offset beyond EOF, etc.) — treated as "can't verify, don't resume". Offset 0 has
 * nothing before it to fingerprint, so it hashes the empty buffer (deterministic, always
 * "matches" — resuming from byte 0 is always safe, there's nothing to have been replaced). */
function fingerprintBefore(transcriptPath, offset) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, "r");
    const start = Math.max(0, offset - FINGERPRINT_WINDOW);
    const length = offset - start;
    const buf = Buffer.alloc(length);
    if (length > 0) fs.readSync(fd, buf, 0, length, start);
    return crypto.createHash("sha1").update(buf).digest("hex");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Load + validate a cache file. Returns `null` (triggering a full rescan) on anything that
 * doesn't look exactly like a cache we could have written for THIS transcript — missing
 * file, corrupt JSON, wrong shape, or a `transcriptPath` mismatch. Never throws. */
function readCache(cacheFp, transcriptPath) {
  try {
    const raw = fs.readFileSync(cacheFp, "utf8");
    const cache = JSON.parse(raw);
    if (
      cache &&
      typeof cache === "object" &&
      cache.transcriptPath === transcriptPath &&
      typeof cache.offset === "number" &&
      typeof cache.size === "number" &&
      typeof cache.mtimeMs === "number" &&
      typeof cache.fingerprint === "string" &&
      cache.state &&
      typeof cache.state === "object"
    ) {
      return cache;
    }
  } catch {
    /* missing/corrupt cache -> full rescan */
  }
  return null;
}

/** Best-effort: a failed cache write just means the NEXT call does a full rescan instead of
 * resuming — never lets a permissions/disk issue break the hook itself. */
function writeCache(cacheFp, cache) {
  try {
    fs.mkdirSync(path.dirname(cacheFp), { recursive: true });
    fs.writeFileSync(cacheFp, JSON.stringify(cache));
  } catch {
    /* best-effort */
  }
}

/**
 * Read `transcriptPath` from byte offset `fromOffset` to EOF, fold each COMPLETE line into
 * `state` via `foldLine(state, line)`, and return the byte offset right after the last
 * complete line consumed (NOT necessarily EOF — a trailing partial line is left for next
 * time). Never throws: an unreadable file leaves `state`/offset unchanged.
 * @param {string} transcriptPath
 * @param {number} fromOffset
 * @param {object} state
 * @param {(state: object, line: string) => object} foldLine
 */
function scanFromOffset(transcriptPath, fromOffset, state, foldLine) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, "r");
    const size = fs.fstatSync(fd).size;
    if (size <= fromOffset) return { offset: fromOffset, state };
    const length = size - fromOffset;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, fromOffset);
    _debugStats.reads++;
    _debugStats.bytesRead += length;
    const chunk = buf.toString("utf8");
    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline === -1) return { offset: fromOffset, state }; // no complete line yet
    for (const line of chunk.slice(0, lastNewline).split("\n")) {
      state = foldLine(state, line);
    }
    return { offset: fromOffset + lastNewline + 1, state };
  } catch {
    return { offset: fromOffset, state };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Get the up-to-date derived state for `transcriptPath`, resuming from the cached offset
 * when it's SAFE to (cache present, matches this transcript + hook, the file has only grown
 * since — same-or-larger size, same-or-later mtime — AND the content fingerprint just before
 * the cached offset still matches what's currently on disk), otherwise doing a full rescan
 * from byte 0. The fingerprint check is what catches a transcript truncated and replaced with
 * unrelated content that then grew past its original cached size — size/mtime alone cannot.
 * Always persists the new offset + state + fingerprint for next time (best-effort, never
 * fatal). Missing transcript -> the caller's `initialState()`, matching the old
 * always-full-rescan behavior's fail-open result for that case.
 * @param {string} transcriptPath
 * @param {string} cacheKey - identifies which hook this cache belongs to (e.g.
 *   "effort-gate", "stop-reminder") — the same transcript is scanned by multiple hooks with
 *   independent accumulator shapes, so each needs its own cache.
 * @param {() => object} initialState - factory for a fresh accumulator (called on a full
 *   rescan / cache miss — a fresh object each time, never shared/mutated across calls).
 * @param {(state: object, line: string) => object} foldLine - folds ONE raw JSONL line into
 *   `state` (mutate-and-return is fine); must have no cross-line lookback beyond `state`
 *   itself, so resuming partway through is equivalent to having scanned from the start.
 * @returns {object} the derived state, fully caught up with the transcript's current
 *   contents — identical to what a full rescan from byte 0 would produce.
 */
export function getIncrementalState(transcriptPath, cacheKey, initialState, foldLine) {
  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return initialState(); // missing transcript -> fail open, same as a full-rescan miss
  }

  const cacheFp = cacheFilePath(transcriptPath, cacheKey);
  const cache = readCache(cacheFp, transcriptPath);
  const sizeAndTimeOk =
    cache !== null &&
    cache.size <= stat.size &&
    cache.offset <= stat.size &&
    cache.mtimeMs <= stat.mtimeMs;
  const canResume =
    sizeAndTimeOk && fingerprintBefore(transcriptPath, cache.offset) === cache.fingerprint;

  const startState = canResume ? cache.state : initialState();
  const startOffset = canResume ? cache.offset : 0;

  const { offset, state } = scanFromOffset(transcriptPath, startOffset, startState, foldLine);

  writeCache(cacheFp, {
    transcriptPath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    offset,
    fingerprint: fingerprintBefore(transcriptPath, offset),
    state
  });

  return state;
}
