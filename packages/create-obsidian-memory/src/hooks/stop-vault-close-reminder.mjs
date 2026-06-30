#!/usr/bin/env node
/**
 * Claude Code `Stop` hook — nudges the vault close ritual, AT MOST ONCE per turn, when
 * the session did substantive file work (Write/Edit/MultiEdit/NotebookEdit) but never
 * touched the vault's close-ritual tools (vault_write_file/vault_edit_file/
 * memory_extract_candidates, or basic-memory's write_note/edit_note).
 *
 * Why: the CLAUDE.md "close ritual" rule is aspirational — a model that never gets
 * reminded at the right moment just stops without writing anything down, and the gap
 * compounds session over session. Same idea as ADR-0029's native-memory override
 * (deterministic beats a prose rule), aimed at the OTHER failure mode: not "the wrong
 * system wins" but "no system wins at all". See ADR-0030.
 *
 * Deliberately conservative: this is a NUDGE, not a hard gate. It gives the model an
 * explicit escape hatch ("nothing reusable this time → ignore and stop") so it doesn't
 * write low-value noise to the vault just to satisfy the hook — that would undermine the
 * "only what's reusable beyond the session" doctrine the vault rules already teach.
 *
 * Loop-safe: Claude Code sets `stop_hook_active:true` on the input when this turn is
 * already continuing because of a prior Stop block. We check it and stand down, so this
 * fires at most once per turn-chain — never a loop.
 *
 * Installed by `create-obsidian-memory` into `~/.claude/hooks/` next to the SessionStart
 * and PreToolUse guard hooks, registered in `~/.claude/settings.json` as:
 *   node "<this file>" [lang]
 *
 * Contract (Claude Code `Stop` hooks):
 *  - Read the hook's JSON payload from stdin (`transcript_path`, `stop_hook_active`, …).
 *  - To block the stop and keep the conversation going, print ONE JSON object to stdout:
 *      { "decision": "block", "reason": "<text shown to Claude as context>" }
 *  - To allow the stop, print nothing and exit 0.
 *  - Never throw: an unreadable/odd transcript must fall through to allowing the stop,
 *    not hang or break the session.
 */
import fs from "node:fs";

const SUBSTANTIVE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
const VAULT_CLOSE_TOOLS =
  /vault_write_file|vault_edit_file|memory_extract_candidates|write_note|edit_note/;
/** Below this many substantive edits, the nudge is more noise than signal — stay quiet. */
const MIN_SUBSTANTIVE_CALLS = 2;

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Best-effort scan of the JSONL transcript for assistant tool_use blocks. Never throws. */
function scanTranscript(transcriptPath) {
  let substantive = 0;
  let vaultTouches = 0;
  let text;
  try {
    text = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return { substantive, vaultTouches };
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== "tool_use" || typeof block.name !== "string") continue;
      if (VAULT_CLOSE_TOOLS.test(block.name)) vaultTouches++;
      else if (SUBSTANTIVE_TOOLS.test(block.name)) substantive++;
    }
  }
  return { substantive, vaultTouches };
}

function reason(lang) {
  if (lang === "en") {
    return (
      "Before stopping: this session edited/wrote files but never touched the Obsidian " +
      "vault (vault_write_file / vault_edit_file / memory_extract_candidates). If there's " +
      "anything reusable beyond this session — a closed decision, an architecture choice, " +
      "a lesson, a gotcha — close it now: SESSION_LOG.md (one line) + " +
      "PROJECTS/<project>.md (incremental). If nothing here is worth saving, ignore this " +
      "and stop normally — don't write low-value notes just to satisfy this reminder."
    );
  }
  return (
    "Antes de terminar: esta sesión editó/escribió archivos pero no tocó el vault " +
    "Obsidian (vault_write_file / vault_edit_file / memory_extract_candidates). Si hay " +
    "algo reutilizable más allá de esta sesión — una decisión cerrada, una elección de " +
    "arquitectura, una lección, un gotcha — ciérralo ahora: SESSION_LOG.md (una línea) + " +
    "PROJECTS/<proyecto>.md (incremental). Si nada de esto vale la pena guardar, ignora " +
    "este aviso y termina normalmente — no escribas notas de bajo valor solo por este recordatorio."
  );
}

function main() {
  const lang = (process.argv[2] || "es").toLowerCase() === "en" ? "en" : "es";

  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    return; // unparseable payload — allow the stop
  }

  if (input?.stop_hook_active) return; // already nudged once this turn-chain — stand down

  const transcriptPath = typeof input?.transcript_path === "string" ? input.transcript_path : "";
  if (!transcriptPath) return;

  const { substantive, vaultTouches } = scanTranscript(transcriptPath);
  if (substantive < MIN_SUBSTANTIVE_CALLS || vaultTouches > 0) return;

  process.stdout.write(JSON.stringify({ decision: "block", reason: reason(lang) }));
}

try {
  main();
} catch {
  // Never let a bug in this hook hang or break the session's ability to stop.
}
