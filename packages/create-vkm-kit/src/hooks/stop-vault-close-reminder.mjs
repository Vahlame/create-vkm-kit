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
 * Installed by create-obsidian-memory — the vkm-kit installer — into `~/.claude/hooks/` next
 * to the SessionStart and PreToolUse guard hooks, registered in `~/.claude/settings.json` as:
 *   node "<this file>" [lang]
 *
 * Contract (Claude Code `Stop` hooks):
 *  - Read the hook's JSON payload from stdin (`transcript_path`, `stop_hook_active`, …).
 *  - To block the stop and keep the conversation going, print ONE JSON object to stdout:
 *      { "decision": "block", "reason": "<text shown to Claude as context>" }
 *  - To allow the stop, print nothing and exit 0.
 *  - Never throw: an unreadable/odd transcript must fall through to allowing the stop,
 *    not hang or break the session.
 *
 * Performance: re-parsing the WHOLE transcript on every Stop event gets slower as a session
 * grows (measured ~75ms on a real 25.8MB transcript) — see `_transcript-cache.mjs` (installed
 * alongside this file) for the sidecar-cache fix that makes each call only read the NEW
 * suffix appended since the last one. Purely a performance change: `scanTranscript` below
 * returns the identical shape/values a full rescan always did.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getIncrementalState } from "./_transcript-cache.mjs";

const SUBSTANTIVE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
// `vault_append_file` is the tool the kit's own rules PRESCRIBE for the close ritual
// ("Cierre = vault_append_file → SESSION_LOG.md"), and it was missing here: a session that
// closed exactly as documented was told three times that it never touched the vault. A guard
// that fires after the work is done trains the model to ignore it, which costs more than the
// guard is worth. `vault_frontmatter_set` is included for the same reason — it writes.
const VAULT_CLOSE_TOOLS =
  /vault_write_file|vault_edit_file|vault_append_file|vault_frontmatter_set|memory_extract_candidates|write_note|edit_note/;
/** Below this many substantive edits, the nudge is more noise than signal — stay quiet. */
const MIN_SUBSTANTIVE_CALLS = 2;

/** Opt-in only (default off): close-ritual nudges bias sessions that did not ask to save memory. */
export function vaultCloseNudgeEnabled() {
  const v = process.env.VKM_VAULT_CLOSE_NUDGE;
  return v === "1" || v === "true";
}

// Shared with the Kimi Code Stop variant (kimi-stop-vault-close-reminder.mjs), which scans
// Kimi's wire.jsonl instead of Claude's transcript but applies the identical policy.
export { SUBSTANTIVE_TOOLS, VAULT_CLOSE_TOOLS, MIN_SUBSTANTIVE_CALLS };

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function initialScanState() {
  return { substantive: 0, vaultTouches: 0 };
}

/** Fold ONE raw JSONL line into `state` (mutate-and-return) — purely additive counters, so
 * folding over just a transcript's NEW suffix gives the identical result as folding from
 * byte 0, which is what makes incremental resumption (`_transcript-cache.mjs`) safe here. */
function foldTranscriptLine(state, line) {
  const trimmed = line.trim();
  if (!trimmed) return state;
  let entry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    return state;
  }
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return state;
  for (const block of content) {
    if (!block || block.type !== "tool_use" || typeof block.name !== "string") continue;
    if (VAULT_CLOSE_TOOLS.test(block.name)) state.vaultTouches++;
    else if (SUBSTANTIVE_TOOLS.test(block.name)) state.substantive++;
  }
  return state;
}

/**
 * Scan of the JSONL transcript for assistant tool_use blocks, computed incrementally via the
 * shared sidecar cache (`_transcript-cache.mjs`) — resumes from the last-consumed byte offset
 * when safe, full rescan otherwise. Never throws; returns the SAME shape a full rescan from
 * byte 0 always did.
 */
export function scanTranscript(transcriptPath) {
  return getIncrementalState(transcriptPath, "stop-reminder", initialScanState, foldTranscriptLine);
}

export function reason(lang) {
  if (lang === "en") {
    return (
      "Optional (only if the user asked to save memory): anything worth keeping beyond this " +
      "session can go to KNOWN_FAILURES.md or PROJECTS/<project>.md — with user confirmation. " +
      "If they did not ask to save, stop normally."
    );
  }
  return (
    "Opcional (solo si el usuario pidió guardar memoria): lo reutilizable puede ir a " +
    "KNOWN_FAILURES.md o PROJECTS/<proyecto>.md — con confirmación del usuario. " +
    "Si no pidió guardar, termina normal."
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
  if (!vaultCloseNudgeEnabled()) return; // default off — no close-ritual bias

  const transcriptPath = typeof input?.transcript_path === "string" ? input.transcript_path : "";
  if (!transcriptPath) return;

  const { substantive, vaultTouches } = scanTranscript(transcriptPath);
  if (substantive < MIN_SUBSTANTIVE_CALLS || vaultTouches > 0) return;

  process.stdout.write(JSON.stringify({ decision: "block", reason: reason(lang) }));
}

// Only auto-run when executed directly (`node stop-vault-close-reminder.mjs ...`), not when
// imported — `scanTranscript` is exported above so tests can unit-test the caching behavior
// directly (call counts, resumed-vs-full-scan byte counts) without a stdin read as an import
// side effect.
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  try {
    main();
  } catch {
    // Never let a bug in this hook hang or break the session's ability to stop.
  }
}
