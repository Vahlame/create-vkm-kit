#!/usr/bin/env node
/**
 * Kimi Code context hook — the kimi sibling of session-start-vault-context.mjs.
 * Same vault map + hard-rule reminders, three deliberate differences:
 *
 *  - Output contract: Kimi appends a hook's STDOUT TEXT to the session context; the
 *    Claude `{"hookSpecificOutput": ...}` JSON envelope is not a Kimi concept. So this
 *    script prints the context as plain text and nothing else.
 *  - Event: `UserPromptSubmit`, NOT `SessionStart`. SessionStart is observation-only in
 *    Kimi — its stdout is dropped (verified live: the hook ran, nothing reached the
 *    context) — while UserPromptSubmit documents "returned text is appended to context".
 *  - At-most-once-per-session: UserPromptSubmit fires on EVERY prompt, so a sidecar
 *    marker (`~/.vkm/kimi-context-injected/<session_id>`) limits the injection to the
 *    first prompt of each session — without it the vault map would tax every message.
 *  - Reminders: kimiReminders() drops the Claude-only lines (native auto-memory
 *    override, ToolSearch) — neither exists in Kimi Code.
 *
 * Registered by the installer in `~/.kimi-code/config.toml` as a `[[hooks]]` entry:
 *   event = "UserPromptSubmit", command = 'node "<this file>" "<vault>" [lang]'
 *
 * Never throws and never blocks: a broken vault path must not hold up a prompt
 * (hooks fail open in Kimi, but exiting 0 quickly is cheaper than a timeout).
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildContext,
  kimiReminders,
  modelChangeNotice,
  resolveVault
} from "./session-start-vault-context.mjs";

/** At-most-once-per-session marker (UserPromptSubmit fires on every prompt). */
function injectedMarker(sessionId, home = os.homedir()) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(home, ".vkm", "kimi-context-injected", `${safe}.json`);
}

/** Drop markers older than a week: one small file per session adds up over months. */
function pruneMarkers(dir, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const cutoff = Date.now() - maxAgeMs;
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) fs.rmSync(fp, { force: true });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* pruning is housekeeping, never a failure */
  }
}

export function main() {
  const vault = resolveVault();
  const lang = (process.argv[3] || "es").toLowerCase() === "en" ? "en" : "es";
  let sessionId = "";
  let sessionModel = null;
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (raw.trim()) {
      const input = JSON.parse(raw);
      sessionId = typeof input?.session_id === "string" ? input.session_id.trim() : "";
      sessionModel = input?.model ?? null;
    }
  } catch {
    /* no payload on stdin (or unparseable) — fall through to first-prompt injection */
  }
  // Without a session id there is no way to bound the injection — skip rather than
  // append the vault map to every prompt forever.
  if (!sessionId) return;
  const marker = injectedMarker(sessionId);
  if (fs.existsSync(marker)) return; // already injected this session — stay silent

  let text;
  try {
    text = buildContext(vault, lang, kimiReminders) + modelChangeNotice(sessionModel, lang);
  } catch {
    text = kimiReminders(lang); // last-resort: never block the prompt
  }
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ injectedAt: Date.now() }), "utf8");
    pruneMarkers(path.dirname(marker));
  } catch {
    /* a missing marker re-injects on the next prompt at worst */
  }
  process.stdout.write(text);
}

// Guard so importing this module (e.g. from a test) does not also run main() as a side
// effect — mirrors the pattern in the other managed hooks.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) main();
