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

const MIN_SUBSTANTIVE = 2;

function reason(lang) {
  if (lang === "en") {
    return (
      "Before stopping: this session edited/wrote files but never touched the Obsidian " +
      "vault (vault_append_file / vault_write_file / vault_edit_file). If there's " +
      "anything reusable beyond this session — a closed decision, an architecture choice, " +
      "a lesson, a gotcha — close it now: SESSION_LOG.md (one line) + " +
      "PROJECTS/<project>.md (incremental). If nothing here is worth saving, ignore this " +
      "and stop normally — don't write low-value notes just to satisfy this reminder."
    );
  }
  return (
    "Antes de terminar: esta sesión editó/escribió archivos pero no tocó el vault " +
    "Obsidian (vault_append_file / vault_write_file / vault_edit_file). Si hay " +
    "algo reutilizable más allá de esta sesión — una decisión cerrada, una elección de " +
    "arquitectura, una lección, un gotcha — ciérralo ahora: SESSION_LOG.md (una línea) + " +
    "PROJECTS/<proyecto>.md (incremental). Si nada de esto vale la pena guardar, ignora " +
    "este aviso y termina normalmente — no escribas notas de bajo valor solo por este recordatorio."
  );
}

export function shouldNudge(state) {
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
