#!/usr/bin/env node
/**
 * Claude Code `PreToolUse` hook — deterministically DENIES a session's 2nd+ substantive
 * Write/Edit/MultiEdit/NotebookEdit call until the model has proposed an effort level
 * (`/effort low|medium|high|xhigh|max`) AND gotten a real reply from the user.
 *
 * Why a hook and not just a CLAUDE.md sentence: a model that announces "pausing for your
 * confirmation" and then immediately keeps calling tools in the same turn is a common
 * failure mode — the announcement is prose, and prose doesn't stop a tool call. Same root
 * cause ADR-0029/ADR-0030 already named: relying on the model to *honor* a rule against an
 * always-available tool is exactly what fails in practice. This hook makes the pause real
 * by denying the call until a genuine user turn happened after the proposal. See ADR-0031.
 *
 * Anti-nagging, mirroring the ADR-0030 `Stop` hook's threshold: the FIRST substantive call
 * of a session is always free (a one-line fix shouldn't need a ritual). Gating starts at
 * the 2nd. Once the gate is satisfied once, it stays open for the rest of the session — this
 * is a one-time checkpoint per session, not a per-task interrogation.
 *
 * Installed by `create-obsidian-memory` into `~/.claude/hooks/` next to the other managed
 * hooks, registered in `~/.claude/settings.json` as:
 *   node "<this file>" [lang]
 * with matcher `"Write|Edit|MultiEdit|NotebookEdit"`. Reads `transcript_path` from the
 * hook's stdin payload (like the `Stop` hook), not from argv — there's no file path to
 * check here, just conversation history.
 *
 * Contract (Claude Code `PreToolUse` hooks):
 *  - Read the hook's JSON payload from stdin (`tool_name`, `transcript_path`, …).
 *  - To deny the call, print ONE JSON object to stdout:
 *      { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *          "permissionDecision": "deny", "permissionDecisionReason": "<text>" } }
 *  - To defer to the normal permission flow, print nothing and exit 0.
 *  - Never throw: a malformed payload or unreadable transcript must fall through to the
 *    normal permission flow (fail OPEN — this hook must never hang or break a session).
 */
import fs from "node:fs";

const SUBSTANTIVE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
/** Below this many PRIOR substantive calls, the gate stays out of the way entirely. */
const MIN_SUBSTANTIVE_CALLS = 2;
/** Matches ONLY the literal marker the model is told to print — see reason() below. */
const MARKER_RE = /\[!\]\s*(recomendaci[oó]n de esfuerzo|effort recommendation)/i;

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * True if a transcript entry is a REAL user turn — as opposed to a tool result, which
 * Claude Code also encodes as a `type:"user"` message (`content: [{type:"tool_result",…}]`).
 * A turn only counts as a genuine reply if it carries the user's own text.
 */
function isRealUserTurn(entry) {
  if (!entry || entry.type !== "user") return false;
  const content = entry?.message?.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((block) => block && block.type !== "tool_result");
}

/**
 * Scan the JSONL transcript in order. Walks each assistant turn's content blocks in
 * array order (text marker before any later tool_use in the SAME prior turn still counts,
 * since the call currently being gated is by definition not yet in this file). `satisfied`
 * is monotonic — once a real user turn follows a proposal, it stays satisfied for the rest
 * of the scan, even if a later unconfirmed proposal appears. Never throws.
 */
function scanTranscript(transcriptPath) {
  let substantiveBefore = 0;
  let pending = false;
  let satisfied = false;
  let text;
  try {
    text = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return { substantiveBefore, pending, satisfied };
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
    if (entry?.type === "assistant") {
      const content = entry?.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block) continue;
          if (block.type === "text" && typeof block.text === "string" && MARKER_RE.test(block.text)) {
            pending = true;
          } else if (block.type === "tool_use" && SUBSTANTIVE_TOOLS.test(block.name || "")) {
            substantiveBefore++;
          }
        }
      }
    } else if (pending && isRealUserTurn(entry)) {
      satisfied = true;
      pending = false;
    }
  }
  return { substantiveBefore, pending, satisfied };
}

function reason(lang, alreadyProposed) {
  if (lang === "en") {
    return alreadyProposed
      ? "Paused: you already proposed an effort level but there's no reply from the user " +
        "yet in this conversation. Do not call any more tools this turn — wait for the " +
        "user's next message before retrying."
      : "Paused: this session is about to make its 2nd+ substantive edit without an effort " +
        "estimate. Before calling any more tools, reply with ONLY this block (no tool " +
        "calls in this turn), then stop and wait for the user's next message:\n\n" +
        "[!] EFFORT RECOMMENDATION\n" +
        "- Task: <short description>\n" +
        "- Suggested level: /effort <low|medium|high|xhigh|max>\n" +
        "- Reason: <why>\n\n" +
        "Retry only after the user replies (confirming or naming a different level). See ADR-0031.";
  }
  return alreadyProposed
    ? "Pausa: ya propusiste un nivel de esfuerzo pero todavía no hay respuesta del usuario " +
      "en esta conversación. No llames más herramientas en este turno — esperá el próximo " +
      "mensaje del usuario antes de reintentar."
    : "Pausa: esta sesión va a hacer su 2.º+ edit sustantivo sin haber propuesto un nivel " +
      "de esfuerzo. Antes de llamar más herramientas, respondé SOLO con este bloque (nada " +
      "de tool calls en este turno), después parate y esperá el próximo mensaje del usuario:\n\n" +
      "[!] RECOMENDACIÓN DE ESFUERZO\n" +
      "- Tarea: <descripción breve>\n" +
      "- Nivel sugerido: /effort <low|medium|high|xhigh|max>\n" +
      "- Razón: <por qué>\n\n" +
      "Reintentá solo después de que el usuario responda (confirmando u otro nivel). Ver ADR-0031.";
}

function main() {
  const lang = (process.argv[2] || "es").toLowerCase() === "en" ? "en" : "es";

  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    return; // unparseable payload — defer to the normal permission flow
  }

  const toolName = typeof input?.tool_name === "string" ? input.tool_name : "";
  if (!SUBSTANTIVE_TOOLS.test(toolName)) return;

  const transcriptPath = typeof input?.transcript_path === "string" ? input.transcript_path : "";
  if (!transcriptPath) return; // no transcript to check against — fail open

  const { substantiveBefore, pending, satisfied } = scanTranscript(transcriptPath);
  if (substantiveBefore === 0) return; // first substantive edit of the session is free
  if (satisfied) return; // gated once already this session — stay out of the way

  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason(lang, pending)
    }
  };
  process.stdout.write(JSON.stringify(payload));
}

try {
  main();
} catch {
  // Never let a bug in this hook block a legitimate tool call.
}
