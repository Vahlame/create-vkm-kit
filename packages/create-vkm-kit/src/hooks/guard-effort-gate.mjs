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
 * Main agent only — never a sub-agent (ADR-0031 addendum): a Task-tool sub-agent (a fanned-out
 * `vkm-implementer`, `Explore`, etc.) cannot ever satisfy this gate — a coordinator's relayed
 * `SendMessage` confirmation and an `AskUserQuestion` answer both land in the transcript as
 * content `isRealUserTurn()` deliberately excludes (see its own doc comment), so a sub-agent
 * would be denied forever, wedging any multi-agent workflow. Claude Code populates `agent_id`
 * on the hook's stdin payload only when the hook fires inside a sub-agent — its presence is
 * the signal to defer immediately, no scan needed. The gate still applies in full to the main
 * agent's own direct edits; this makes it neutral toward delegation, neither encouraging nor
 * blocking it, rather than an obstacle a workflow has to route around.
 *
 * Installed by create-obsidian-memory — the vkm-kit installer — into `~/.claude/hooks/` next
 * to the other managed hooks, registered in `~/.claude/settings.json` as:
 *   node "<this file>" [lang]
 * with matcher `"Write|Edit|MultiEdit|NotebookEdit"`. Reads `transcript_path` from the
 * hook's stdin payload (like the `Stop` hook), not from argv — there's no file path to
 * check here, just conversation history.
 *
 * Contract (Claude Code `PreToolUse` hooks):
 *  - Read the hook's JSON payload from stdin (`tool_name`, `transcript_path`, `agent_id`, …
 *    — `agent_id` is populated only inside a sub-agent call, see the main-agent-only note above).
 *  - To deny the call, print ONE JSON object to stdout:
 *      { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *          "permissionDecision": "deny", "permissionDecisionReason": "<text>" } }
 *  - To defer to the normal permission flow, print nothing and exit 0.
 *  - Never throw: a malformed payload or unreadable transcript must fall through to the
 *    normal permission flow (fail OPEN — this hook must never hang or break a session).
 *
 * Performance: re-parsing the WHOLE transcript on every gated call gets slower as a session
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

function initialScanState() {
  return { substantiveBefore: 0, pending: false, satisfied: false };
}

/**
 * Fold ONE raw JSONL line into `state` (mutate-and-return). Same per-line logic the old
 * always-full-rescan version used, factored out so it can run over just the transcript's
 * NEW suffix (see `_transcript-cache.mjs`) with an identical result to scanning from byte 0:
 * each line's effect depends only on itself and the accumulator so far (`pending` gates
 * whether a later user turn sets `satisfied`), never on lines further ahead.
 */
function foldTranscriptLine(state, line) {
  const trimmed = line.trim();
  if (!trimmed) return state;
  let entry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    return state;
  }
  if (entry?.type === "assistant") {
    const content = entry?.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block) continue;
        if (block.type === "text" && typeof block.text === "string" && MARKER_RE.test(block.text)) {
          state.pending = true;
        } else if (block.type === "tool_use" && SUBSTANTIVE_TOOLS.test(block.name || "")) {
          state.substantiveBefore++;
        }
      }
    }
  } else if (state.pending && isRealUserTurn(entry)) {
    state.satisfied = true;
    state.pending = false;
  }
  return state;
}

/**
 * Scan the JSONL transcript in order (walks each assistant turn's content blocks in array
 * order — text marker before any later tool_use in the SAME prior turn still counts, since
 * the call currently being gated is by definition not yet in this file; `satisfied` is
 * monotonic, staying set for the rest of the scan once a real user turn follows a proposal).
 * Computed incrementally via the shared sidecar cache (`_transcript-cache.mjs`) — resumes
 * from the last-consumed byte offset when safe, full rescan otherwise. Never throws; returns
 * the SAME shape a full rescan from byte 0 always did.
 */
export function scanTranscript(transcriptPath) {
  return getIncrementalState(transcriptPath, "effort-gate", initialScanState, foldTranscriptLine);
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

  // Sub-agent call — see the file header for why this can never be satisfied from in here.
  if (typeof input?.agent_id === "string" && input.agent_id) return;

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

// Only auto-run when executed directly (`node guard-effort-gate.mjs ...`), not when imported
// — `scanTranscript` is exported above so tests can unit-test the caching behavior directly
// (call counts, resumed-vs-full-scan byte counts) without a stdin read as an import side effect.
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  try {
    main();
  } catch {
    // Never let a bug in this hook block a legitimate tool call.
  }
}
