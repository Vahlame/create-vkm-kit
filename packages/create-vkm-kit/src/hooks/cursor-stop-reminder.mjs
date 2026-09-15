#!/usr/bin/env node
/**
 * Cursor `stop` hook — nudges the vault close ritual when the session edited
 * files but never touched vault write tools (tracked via cursor-session-state).
 *
 * Installed by create-vkm-kit (vkm-kit).
 * Contract: `{ "followup_message": "<nudge>" }` to continue; empty to allow stop.
 */
import { pathToFileURL } from "node:url";
import { markNudged, readState } from "./cursor-session-state.mjs";
import { vaultCloseNudgeEnabled, reason } from "./stop-vault-close-reminder.mjs";

const MIN_SUBSTANTIVE = 2;

export function shouldNudge(state) {
  if (!vaultCloseNudgeEnabled()) return false;
  if (!state || state.nudged) return false;
  if (state.substantive < MIN_SUBSTANTIVE) return false;
  if (state.vaultTouches > 0) return false;
  return true;
}

export function main() {
  const lang = (process.argv[2] || "es").toLowerCase() === "en" ? "en" : "es";
  const state = readState();
  if (!shouldNudge(state)) return;
  markNudged();
  process.stdout.write(JSON.stringify({ followup_message: reason(lang) }));
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    /* never block stop on error */
  }
}
