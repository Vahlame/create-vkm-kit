#!/usr/bin/env node
/**
 * Kimi Code `Stop` hook — the kimi sibling of stop-vault-close-reminder.mjs. Same nudge,
 * same policy (shared regexes/threshold/reason text), three kimi-specific adaptations:
 *
 *  - Transcript: Kimi keeps no `transcript_path`; the session transcript is
 *    `$KIMI_CODE_HOME/sessions/<wd>/session_<id>/agents/main/wire.jsonl`, located here
 *    from the payload's `session_id`. Tool calls are
 *    `{"type":"context.append_loop_event","event":{"type":"tool.call","name":...}}` lines.
 *  - Blocking contract: exit code 2 with the reason on stderr (Kimi writes it back into
 *    the context so the model can do the close ritual and stop again).
 *  - Loop safety: Kimi documents no `stop_hook_active`, so the at-most-once-per-session
 *    guard is a sidecar marker under `~/.vkm/kimi-stop-nudge/` written before blocking.
 *
 * Fail-open everywhere: an unreadable payload, a missing wire file or any I/O error all
 * ALLOW the stop — a reminder hook must never trap a session.
 *
 * Registered by the installer in `~/.kimi-code/config.toml` as a `[[hooks]]` entry:
 *   event = "Stop", command = 'node "<this file>" [lang]'
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIN_SUBSTANTIVE_CALLS,
  SUBSTANTIVE_TOOLS,
  VAULT_CLOSE_TOOLS,
  reason
} from "./stop-vault-close-reminder.mjs";

/** Kimi Code data root: $KIMI_CODE_HOME, else ~/.kimi-code. */
function kimiRoot(home = os.homedir()) {
  const override = process.env.KIMI_CODE_HOME;
  return override && override.trim() ? override.trim() : path.join(home, ".kimi-code");
}

/**
 * Locate this session's wire.jsonl under `<kimiRoot>/sessions/<wd>/session_<id>/agents/main/`.
 * Returns "" when not found — the hook then simply allows the stop.
 */
export function findWireFile(sessionId, home = os.homedir()) {
  try {
    const sessionsDir = path.join(kimiRoot(home), "sessions");
    const wanted = `session_${sessionId}`;
    for (const wd of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!wd.isDirectory()) continue;
      const fp = path.join(sessionsDir, wd.name, wanted, "agents", "main", "wire.jsonl");
      if (fs.existsSync(fp)) return fp;
    }
  } catch {
    /* fall through — not found */
  }
  return "";
}

/** Fold ONE raw wire.jsonl line into `state` (mutate-and-return). */
export function foldWireLine(state, line) {
  const trimmed = line.trim();
  if (!trimmed) return state;
  let entry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    return state;
  }
  const event = entry?.event;
  if (event?.type !== "tool.call" || typeof event.name !== "string") return state;
  if (VAULT_CLOSE_TOOLS.test(event.name)) state.vaultTouches++;
  else if (SUBSTANTIVE_TOOLS.test(event.name)) state.substantive++;
  return state;
}

/** Count substantive edits vs vault close-ritual touches in a kimi wire.jsonl. */
export function scanWire(wirePath) {
  const state = { substantive: 0, vaultTouches: 0 };
  let text;
  try {
    text = fs.readFileSync(wirePath, "utf8");
  } catch {
    return state; // unreadable transcript → zeros → allow the stop
  }
  for (const line of text.split(/\r?\n/)) foldWireLine(state, line);
  return state;
}

/** At-most-once-per-session marker (Kimi has no stop_hook_active). */
function nudgeMarker(sessionId, home = os.homedir()) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(home, ".vkm", "kimi-stop-nudge", `${safe}.json`);
}

function main() {
  const lang = (process.argv[2] || "es").toLowerCase() === "en" ? "en" : "es";

  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return; // unparseable payload — allow the stop
  }
  const sessionId = typeof input?.session_id === "string" ? input.session_id.trim() : "";
  if (!sessionId) return;

  const marker = nudgeMarker(sessionId);
  if (fs.existsSync(marker)) return; // already nudged this session — stand down

  const wirePath = findWireFile(sessionId);
  if (!wirePath) return;

  const { substantive, vaultTouches } = scanWire(wirePath);
  if (substantive < MIN_SUBSTANTIVE_CALLS || vaultTouches > 0) return;

  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ nudgedAt: Date.now() }), "utf8");
  } catch {
    /* a missing marker re-nudges next session at worst — still not a loop within this one */
  }
  console.error(reason(lang));
  process.exit(2);
}

// Only auto-run when executed directly, not when imported — scanWire/foldWireLine are
// exported so tests can drive them without a stdin read as an import side effect.
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  try {
    main();
  } catch {
    // Never let a bug in this hook trap the session's ability to stop.
  }
}
