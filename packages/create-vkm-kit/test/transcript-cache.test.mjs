import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  getIncrementalState,
  _debugStats,
  _resetDebugStats
} from "../src/hooks/_transcript-cache.mjs";
import { scanTranscript as effortGateScan } from "../src/hooks/guard-effort-gate.mjs";
import { scanTranscript as stopReminderScan } from "../src/hooks/stop-vault-close-reminder.mjs";

// ---- item 3: sidecar cache so repeated hook calls don't re-parse the WHOLE transcript ----

function tmpTranscript(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, "transcript.jsonl");
}

/** A trivial reducer for exercising the generic engine directly: counts non-blank lines. */
function countInitial() {
  return { count: 0 };
}
function countFold(state, line) {
  if (line.trim()) state.count++;
  return state;
}

test("getIncrementalState: a fresh transcript is fully scanned (no cache yet)", () => {
  const fp = tmpTranscript("tc-fresh-");
  fs.writeFileSync(fp, "a\nb\nc\n", "utf8");
  const state = getIncrementalState(fp, "test-fresh", countInitial, countFold);
  assert.equal(state.count, 3);
});

test("getIncrementalState: a second call only reads the NEW suffix (bytes-read assertion)", () => {
  const fp = tmpTranscript("tc-suffix-");
  fs.writeFileSync(fp, "a\nb\nc\n", "utf8");
  const cacheKey = `test-suffix-${Date.now()}`;

  _resetDebugStats();
  const first = getIncrementalState(fp, cacheKey, countInitial, countFold);
  assert.equal(first.count, 3);
  const firstBytesRead = _debugStats.bytesRead;
  assert.ok(firstBytesRead > 0, "first call actually read the file");

  // Append more content — a real session growing the transcript.
  fs.appendFileSync(fp, "d\ne\n", "utf8");

  _resetDebugStats();
  const second = getIncrementalState(fp, cacheKey, countInitial, countFold);
  assert.equal(second.count, 5, "cumulative count reflects the whole file");
  assert.ok(
    _debugStats.bytesRead < firstBytesRead,
    `resumed call (${_debugStats.bytesRead}b) must read fewer bytes than the first full scan (${firstBytesRead}b)`
  );
  assert.ok(
    _debugStats.bytesRead > 0 && _debugStats.bytesRead <= "d\ne\n".length + 1,
    "roughly just the delta"
  );
});

test("getIncrementalState: a THIRD call with no new content reads zero new bytes", () => {
  const fp = tmpTranscript("tc-noop-");
  fs.writeFileSync(fp, "a\nb\n", "utf8");
  const cacheKey = `test-noop-${Date.now()}`;
  getIncrementalState(fp, cacheKey, countInitial, countFold);

  _resetDebugStats();
  const state = getIncrementalState(fp, cacheKey, countInitial, countFold);
  assert.equal(state.count, 2, "state unchanged");
  assert.equal(_debugStats.bytesRead, 0, "nothing new to read");
});

test("getIncrementalState: a truncated/replaced transcript triggers a safe full rescan", () => {
  const fp = tmpTranscript("tc-truncate-");
  const cacheKey = `test-truncate-${Date.now()}`;
  fs.writeFileSync(fp, "a\nb\nc\nd\ne\n", "utf8");
  const before = getIncrementalState(fp, cacheKey, countInitial, countFold);
  assert.equal(before.count, 5);

  // Simulate the transcript being replaced by a NEW, shorter one at the same path (e.g. a
  // fresh session reusing a stale path) — must never crash, and must never keep counting
  // from the stale cached offset (which would now point past EOF or into unrelated bytes).
  fs.writeFileSync(fp, "x\ny\n", "utf8");
  const after = getIncrementalState(fp, cacheKey, countInitial, countFold);
  assert.equal(after.count, 2, "full rescan of the NEW content, not stale accumulated state");
});

test("getIncrementalState: a missing transcript returns the caller's initial state (fail open)", () => {
  const fp = path.join(os.tmpdir(), `does-not-exist-tc-${Date.now()}.jsonl`);
  const state = getIncrementalState(fp, "test-missing", countInitial, countFold);
  assert.deepEqual(state, { count: 0 });
});

test("getIncrementalState: a corrupt cache file falls back to a full rescan, not a crash", () => {
  const fp = tmpTranscript("tc-corrupt-");
  fs.writeFileSync(fp, "a\nb\nc\n", "utf8");
  const cacheKey = `test-corrupt-${Date.now()}`;
  getIncrementalState(fp, cacheKey, countInitial, countFold); // creates a valid cache

  // Corrupt the cache file directly (same hashing scheme _transcript-cache.mjs uses).
  const digest = crypto.createHash("sha1").update(path.resolve(fp)).digest("hex");
  const cacheFp = path.join(
    os.tmpdir(),
    "obsidian-memory-kit-hook-cache",
    `${digest}.${cacheKey}.json`
  );
  fs.writeFileSync(cacheFp, "{not valid json", "utf8");

  const state = getIncrementalState(fp, cacheKey, countInitial, countFold);
  assert.equal(state.count, 3, "corrupt cache -> safe full rescan, correct result");
});

test("getIncrementalState: a trailing partial (not-yet-newline-terminated) line is not consumed early", () => {
  const fp = tmpTranscript("tc-partial-");
  const cacheKey = `test-partial-${Date.now()}`;
  // Two complete lines + one partial line with NO trailing newline (transcript mid-write).
  fs.writeFileSync(fp, "a\nb\npartial-no-newline-yet", "utf8");
  const first = getIncrementalState(fp, cacheKey, countInitial, countFold);
  assert.equal(first.count, 2, "the incomplete trailing line is not counted yet");

  // "Complete" that line and add a new one.
  fs.appendFileSync(fp, "\nd\n", "utf8");
  const second = getIncrementalState(fp, cacheKey, countInitial, countFold);
  assert.equal(second.count, 4, "now-completed line + the new one are both counted, nothing lost");
});

test("getIncrementalState: two independent cacheKeys against the SAME transcript never collide", () => {
  const fp = tmpTranscript("tc-multi-key-");
  fs.writeFileSync(fp, "a\nb\n", "utf8");
  const stateA = getIncrementalState(fp, `key-a-${Date.now()}`, countInitial, countFold);
  const stateB = getIncrementalState(fp, `key-b-${Date.now()}`, countInitial, countFold);
  assert.equal(stateA.count, 2);
  assert.equal(stateB.count, 2);
});

// ---- behavior parity: incremental result === what a single full scan would produce --------

/** Build a synthetic transcript mixing assistant tool_use/text blocks and user turns, in the
 * exact JSONL shape both hooks expect. Shared so effort-gate and stop-reminder parity tests
 * exercise identical input. */
function syntheticTranscriptLines() {
  return [
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Edit", input: {} }] }
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "[!] EFFORT RECOMMENDATION\n- Task: x\n- Suggested level: /effort low\n- Reason: y"
          }
        ]
      }
    }),
    JSON.stringify({ type: "user", message: { content: "confirmed, go ahead" } }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Write", input: {} },
          { type: "tool_use", name: "mcp__obsidian-memory-hybrid__vault_write_file", input: {} }
        ]
      }
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "MultiEdit", input: {} }] }
    })
  ];
}

test("effort-gate scanTranscript: incremental result matches a single-shot full scan", () => {
  const lines = syntheticTranscriptLines();
  const fullFp = tmpTranscript("tc-parity-eg-full-");
  fs.writeFileSync(fullFp, `${lines.join("\n")}\n`, "utf8");
  const full = effortGateScan(fullFp);

  const incFp = tmpTranscript("tc-parity-eg-inc-");
  const mid = Math.ceil(lines.length / 2);
  fs.writeFileSync(incFp, `${lines.slice(0, mid).join("\n")}\n`, "utf8");
  effortGateScan(incFp); // first partial scan, primes the cache
  fs.appendFileSync(incFp, `${lines.slice(mid).join("\n")}\n`, "utf8");
  const incremental = effortGateScan(incFp); // resumes from the cached offset

  assert.deepEqual(incremental, full, "resumed scan must equal a from-scratch full scan");
  assert.equal(full.substantiveBefore, 3);
  assert.equal(full.satisfied, true);
});

test("stop-reminder scanTranscript: incremental result matches a single-shot full scan", () => {
  const lines = syntheticTranscriptLines();
  const fullFp = tmpTranscript("tc-parity-stop-full-");
  fs.writeFileSync(fullFp, `${lines.join("\n")}\n`, "utf8");
  const full = stopReminderScan(fullFp);

  const incFp = tmpTranscript("tc-parity-stop-inc-");
  const mid = Math.ceil(lines.length / 2);
  fs.writeFileSync(incFp, `${lines.slice(0, mid).join("\n")}\n`, "utf8");
  stopReminderScan(incFp);
  fs.appendFileSync(incFp, `${lines.slice(mid).join("\n")}\n`, "utf8");
  const incremental = stopReminderScan(incFp);

  assert.deepEqual(incremental, full, "resumed scan must equal a from-scratch full scan");
  assert.equal(full.substantive, 3);
  assert.equal(full.vaultTouches, 1);
});

test("effort-gate scanTranscript: a real 2nd hook invocation reads far less than the full transcript", () => {
  const fp = tmpTranscript("tc-eg-perf-");
  const bulkLines = [];
  for (let i = 0; i < 200; i++) {
    bulkLines.push(JSON.stringify({ type: "user", message: { content: `padding ${i}` } }));
  }
  fs.writeFileSync(fp, `${bulkLines.join("\n")}\n`, "utf8");

  _resetDebugStats();
  effortGateScan(fp);
  const firstCallBytes = _debugStats.bytesRead;
  assert.ok(firstCallBytes > 1000, "sanity: the synthetic transcript is non-trivially sized");

  fs.appendFileSync(
    fp,
    `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: {} }] } })}\n`,
    "utf8"
  );
  _resetDebugStats();
  effortGateScan(fp);
  assert.ok(
    _debugStats.bytesRead < firstCallBytes / 10,
    `2nd call (${_debugStats.bytesRead}b) should read roughly just the appended line, not the ${firstCallBytes}b transcript again`
  );
});
