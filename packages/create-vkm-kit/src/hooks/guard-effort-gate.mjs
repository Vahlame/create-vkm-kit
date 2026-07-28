#!/usr/bin/env node
/**
 * Claude Code `PreToolUse` hook — picks the effort level (and model) this session's work
 * actually calls for, PERSISTS it, and interrupts ONCE when the live session is running
 * at something else.
 *
 * # What changed, and why (ADR-0080, superseding the ADR-0031 protocol)
 *
 * The first version asked the MODEL to print a `[!] EFFORT RECOMMENDATION` block and
 * denied every substantive edit until a real user turn followed it. Two things were wrong
 * with that:
 *
 *   1. It made the user do the thinking twice — read a proposal, then type `/effort x`.
 *   2. It could WEDGE an autonomous session. The gate opened only when the block parsed
 *      and matched, so any drift in how the model phrased it left the session denied
 *      forever with no user around to reply. Recorded three times in KNOWN_FAILURES
 *      (2026-07-11, 07-19, 07-25) before this rewrite, and once more while writing it.
 *
 * Now the hook decides for itself from what it can actually observe, writes the decision
 * where Claude Code will pick it up, and interrupts AT MOST ONCE per session — so a
 * missed signal costs one paragraph of text, never a stuck session.
 *
 * # What the API allows (measured 2026-07-27, not assumed)
 *
 *   - `effort.level` arrives on this hook's stdin payload — the level the model ACTUALLY
 *     ran at (downgraded if the model does not support the requested one). `$CLAUDE_EFFORT`
 *     carries the same value and is the fallback for older builds.
 *   - Writing `effortLevel` into `~/.claude/settings.json` does NOT change the running
 *     session. Probed with a temporary PostToolUse hook: after setting `max`, four
 *     consecutive tool calls still reported `xhigh`. It is documented as persistence
 *     ("Persist the effort level across sessions"), and that is exactly how it is used
 *     here — the NEXT session starts where this one concluded it should have been.
 *   - The model cannot be switched from a hook at all: `model` is read once at session
 *     start, `/model` is the mid-session switch, and there is no `$CLAUDE_MODEL`. Only a
 *     `SessionStart` hook even RECEIVES the model, which is why the sibling
 *     `session-start-vault-context.mjs` records it in the sidecar this file reads.
 *
 * So "apply it automatically" means: persist both for the next session, and surface the
 * one-line command that applies them now. Anything else would be a hook claiming an
 * effect it does not have — the failure mode this kit exists to prevent.
 *
 * # Guarantees
 *
 *   - The first substantive edit of a session is always free.
 *   - AT MOST ONE interruption per session (a sidecar file under `~/.vkm/effort-gate/`
 *     records it), whatever happens afterwards. No transcript parsing decides this.
 *   - Never fires inside a sub-agent (`agent_id` present) — a sub-agent cannot answer.
 *   - Never recommends `fable`, and never touches the model of a session already on it:
 *     that is a deliberate choice by the user, not a default to correct.
 *   - Kill switch without uninstalling: `VKM_EFFORT_GATE=0`.
 *   - Never throws. Any error path falls through to the normal permission flow.
 *
 * Registered by the vkm-kit installer in `~/.claude/settings.json` as:
 *   <launcher> "<this file>" [lang]     matcher: "Write|Edit|MultiEdit|NotebookEdit"
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getIncrementalState } from "./_transcript-cache.mjs";

const SUBSTANTIVE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|apply_patch)$/;

/** Ordered weakest → strongest; index is the comparison. */
export const LEVELS = ["low", "medium", "high", "xhigh", "max"];

/**
 * Model families this hook may RECOMMEND, weakest → strongest. `fable` is absent on
 * purpose (see the header) and `haiku` is opt-in via `VKM_EFFORT_ALLOW_HAIKU=1`: dropping
 * a session to the smallest model to save cost is a call the user makes, not one a hook
 * makes for them, and the failure it produces (fluent, wrong, confident) is the expensive
 * kind. Upgrades are the safe direction and happen by default.
 */
const MODEL_TIERS = ["haiku", "sonnet", "opus"];

/** A model the hook must never select or override. */
export const EXCLUDED_MODEL = "fable";

/** Paths whose edits carry consequences a rollback does not undo. */
const RISKY_PATH_RE =
  /(auth|login|session|secur|crypto|password|secret|token|credential|\.env|migrations?\/|payment|billing|invoice|licen[cs]e|permission|sudo|privile)/i;

/** Paths that change what OTHER machines run: release, CI, packaging, deploy. */
const RELEASE_PATH_RE =
  /(\.github[/\\]workflows|dockerfile|docker-compose|[/\\]k8s[/\\]|helm|terraform|\.tf$|package\.json$|package-lock\.json$|pyproject\.toml$|go\.mod$|cargo\.toml$|\.csproj$|installer|publish|release)/i;

/** Prose-only work: real, but not what a top-tier model is for. */
const PROSE_PATH_RE = /\.(md|mdx|txt|rst|adoc)$/i;

/** User phrasing that raises the stakes of whatever is being edited. */
const HIGH_STAKES_RE =
  /(producci[óo]n|production|prod\b|deploy|release|publicar|urgent|urgente|cr[íi]tico|critical|incident|incidente|ca[íi]do|outage|seguridad|security|vulnerab|exploit|migraci[óo]n|migration|refactor|breaking|arquitectura|architecture|dinero|cobro|pago|payment)/i;

/** User phrasing that lowers them. */
const LOW_STAKES_RE =
  /(typo|tipo(?:graf[íi]a)?|renombr|rename|comentario|comment|formato|format|lint|readme|docstring|traducci[óo]n|translat|r[áa]pid[oa]|quick|peque[ñn]o|small|trivial)/i;

/** Levels the hook is willing to name; anything else is treated as unknown. */
const LEVEL_SET = new Set(LEVELS);

/**
 * The level the session is ACTUALLY running at.
 *
 * The payload's `effort.level` is authoritative — it reports the level after any downgrade
 * the current model forced, which is the number a recommendation must be compared against.
 * `CLAUDE_EFFORT` is the fallback for builds that predate the payload field, and the env
 * var alone is what the old version read (its absence is what made the gate nag).
 *
 * @param {object} [input] the hook's stdin payload
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null} one of LEVELS, or null when undetectable
 */
export function currentEffort(input = {}, env = process.env) {
  const fromPayload = String(input?.effort?.level ?? "")
    .toLowerCase()
    .trim();
  if (LEVEL_SET.has(fromPayload)) return fromPayload;
  const fromEnv = (env.CLAUDE_EFFORT ?? env.CLAUDE_CODE_EFFORT ?? "").toLowerCase().trim();
  return LEVEL_SET.has(fromEnv) ? fromEnv : null;
}

/** `claude-opus-5`, `opus`, `{id: "claude-3-5-haiku"}` → `"opus"` / `"haiku"` / null. */
export function modelFamily(model) {
  const raw =
    typeof model === "string"
      ? model
      : typeof model === "object" && model
        ? String(model.id ?? model.model ?? model.display_name ?? model.name ?? "")
        : "";
  const m = raw.toLowerCase().match(/(opus|sonnet|haiku|fable)/);
  return m ? m[1] : null;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Where the SessionStart hook parks what only IT can see, keyed by session. */
export function sessionDir(home = os.homedir()) {
  return path.join(home, ".vkm", "effort-gate");
}

/** Per-session sidecar path. `session_id` is opaque; keep it filename-safe. */
export function sessionFile(sessionId, home = os.homedir()) {
  const safe = String(sessionId || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(sessionDir(home), `${safe}.json`);
}

/** Read the per-session sidecar; `{}` when absent or unreadable. */
export function readSessionState(sessionId, home = os.homedir()) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(sessionId, home), "utf8")) || {};
  } catch {
    return {};
  }
}

/** Merge-and-write the per-session sidecar. Best-effort; never throws. */
export function writeSessionState(sessionId, patch, home = os.homedir()) {
  try {
    const fp = sessionFile(sessionId, home);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const next = { ...readSessionState(sessionId, home), ...patch };
    fs.writeFileSync(fp, JSON.stringify(next), "utf8");
    return next;
  } catch {
    return null;
  }
}

function initialScanState() {
  return { substantiveBefore: 0, files: [], stakes: 0 };
}

/** Cap on remembered paths: the score saturates long before this, and a 25MB transcript
 * must not turn into a 25MB array. */
const MAX_TRACKED_FILES = 64;

/**
 * Fold ONE transcript line into the accumulator. Same incremental-resume contract the
 * cache needs: a line's effect depends only on itself and the state so far.
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
    if (!Array.isArray(content)) return state;
    for (const block of content) {
      if (!block || block.type !== "tool_use") continue;
      if (!SUBSTANTIVE_TOOLS.test(block.name || "")) continue;
      state.substantiveBefore++;
      const fp = block?.input?.file_path ?? block?.input?.notebook_path;
      if (typeof fp === "string" && fp && state.files.length < MAX_TRACKED_FILES) {
        if (!state.files.includes(fp)) state.files.push(fp);
      }
    }
    return state;
  }

  // A user turn's own text — never a tool_result, which Claude Code also types as "user".
  if (entry?.type === "user") {
    const content = entry?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((b) => b && b.type === "text" && typeof b.text === "string")
              .map((b) => b.text)
              .join("\n")
          : "";
    if (!text) return state;
    if (HIGH_STAKES_RE.test(text)) state.stakes += 1;
    if (LOW_STAKES_RE.test(text)) state.stakes -= 1;
  }
  return state;
}

/**
 * Session shape so far: how many substantive edits, which files, and which way the user's
 * own words push the stakes. Incremental (see `_transcript-cache.mjs`); returns what a
 * full rescan from byte 0 would.
 */
export function scanTranscript(transcriptPath) {
  return getIncrementalState(transcriptPath, "effort-gate", initialScanState, foldTranscriptLine);
}

/**
 * Score the session's work, 0 (trivial) upward. Deterministic and explainable: every
 * component returns a reason string, so the interruption can say WHY instead of asserting
 * a level. Bounded, cheap, and no model call — this runs on every edit.
 *
 * @param {{files?: string[], currentFile?: string, editChars?: number, stakes?: number,
 *   substantiveBefore?: number}} facts
 * @returns {{score: number, why: string[]}}
 */
export function scoreTask(facts = {}) {
  const files = [...(facts.files ?? [])];
  if (facts.currentFile && !files.includes(facts.currentFile)) files.push(facts.currentFile);
  const why = [];
  let score = 20; // a standard edit sits at "medium" and moves from there

  if (files.some((f) => RISKY_PATH_RE.test(f))) {
    score += 30;
    why.push("security/data-sensitive path");
  }
  if (files.some((f) => RELEASE_PATH_RE.test(f))) {
    score += 20;
    why.push("release/CI/packaging path");
  }
  if (files.length >= 12) {
    score += 25;
    why.push(`${files.length} files touched`);
  } else if (files.length >= 5) {
    score += 15;
    why.push(`${files.length} files touched`);
  }
  if ((facts.substantiveBefore ?? 0) >= 20) {
    score += 10;
    why.push("long editing session");
  }

  const stakes = facts.stakes ?? 0;
  if (stakes > 0) {
    score += Math.min(20, stakes * 10);
    why.push("high-stakes wording from the user");
  } else if (stakes < 0) {
    score -= Math.min(20, -stakes * 10);
    why.push("low-stakes wording from the user");
  }

  const proseOnly = files.length > 0 && files.every((f) => PROSE_PATH_RE.test(f));
  if (proseOnly) {
    score -= 20;
    why.push("prose-only changes");
  }
  if (typeof facts.editChars === "number" && facts.editChars > 0 && facts.editChars < 200) {
    score -= 10;
    why.push("small edit");
  }

  return { score: Math.max(0, score), why };
}

/** Score → effort level. Thresholds are the only place the mapping lives. */
export function levelForScore(score) {
  if (score >= 75) return "max";
  if (score >= 55) return "xhigh";
  if (score >= 35) return "high";
  if (score >= 15) return "medium";
  return "low";
}

/**
 * The (effort, model) this session's work calls for, and whether either differs from what
 * it is actually running.
 *
 * The model recommendation is deliberately conservative: it only ever names a model when
 * the current one is KNOWN (a guess is not worth an interruption), never names `fable`,
 * never overrides a session already on `fable`, and never proposes a downgrade unless the
 * user opted into that with `VKM_EFFORT_ALLOW_HAIKU=1`.
 *
 * @returns {{effort: string, why: string[], model: string|null, currentModel: string|null}}
 */
export function recommend(facts, { currentModel = null, env = process.env } = {}) {
  const { score, why } = scoreTask(facts);
  const effort = levelForScore(score);

  const allowDowngrade = env.VKM_EFFORT_ALLOW_HAIKU === "1";
  let model = null;
  if (currentModel && currentModel !== EXCLUDED_MODEL) {
    const wanted = score >= 35 ? "opus" : score >= 15 ? "sonnet" : allowDowngrade ? "haiku" : null;
    if (wanted && wanted !== currentModel) {
      const up = MODEL_TIERS.indexOf(wanted) > MODEL_TIERS.indexOf(currentModel);
      if (up || allowDowngrade) model = wanted;
    }
  }
  return { effort, why, model, currentModel };
}

/**
 * Persist the decision into `~/.claude/settings.json`, the file Claude Code reads at
 * session start. Read-modify-write through a temp file so a half-written settings.json
 * can never exist, and never touching a key we did not decide.
 *
 * `model` is written only when the caller says so (i.e. only alongside an interruption the
 * user can see) — a hook silently changing which model the next session runs is exactly
 * the kind of invisible action this kit refuses to take.
 *
 * @returns {string[]} the keys actually changed
 */
export function persistDecision({ effort, model }, home = os.homedir()) {
  const fp = path.join(home, ".claude", "settings.json");
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const settings = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    const changed = [];
    if (effort && settings.effortLevel !== effort) {
      settings.effortLevel = effort;
      changed.push("effortLevel");
    }
    if (model && settings.model !== model) {
      settings.model = model;
      changed.push("model");
    }
    if (!changed.length) return [];
    const tmp = `${fp}.vkm-tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, fp);
    return changed;
  } catch {
    return [];
  }
}

/**
 * The one-time interruption text, marked `[vkm-effort]` so it is recognizable in a
 * transcript.
 *
 * It is written as a LADDER, most-automatic first, because no hook can change a running
 * session's model or effort — verified against the hooks reference and measured here
 * (see the header). What a hook CAN do is put the work on the right model:
 *
 *   1. delegate this edit to a sub-agent pinned to that model — real, live, and needs
 *      nobody: a sub-agent runs on the model the Task/Agent call names;
 *   2. the user types `/model` + `/effort` once and the whole session moves;
 *   3. the decision is already persisted, so the NEXT session simply starts there.
 *
 * Rung 1 is what makes this useful in an unattended session; rung 3 is what makes it
 * useful when nobody reads the message at all.
 */
export function reason(lang, { effort, current, model, currentModel, why, persisted }) {
  const apply = [
    model ? `/model ${model}` : null,
    effort !== current ? `/effort ${effort}` : null
  ].filter(Boolean);
  const because = why.length
    ? why.join(", ")
    : lang === "en"
      ? "routine change"
      : "cambio rutinario";

  if (lang === "en") {
    return (
      "[vkm-effort] One-time calibration for this session.\n" +
      `The work so far (${because}) calls for /effort ${effort}` +
      (model ? ` on ${model}` : "") +
      `; the session is running /effort ${current ?? "unknown"}` +
      (currentModel ? ` on ${currentModel}` : "") +
      ".\n" +
      (model
        ? `APPLY IT NOW, without waiting for anyone: redo this edit through a sub-agent ` +
          `pinned to that model (Task/Agent with model: "${model}") — a hook cannot switch ` +
          `the session's own model, but the sub-agent genuinely runs on the one it is given.\n`
        : "") +
      (apply.length ? `For the WHOLE session, the user types: ${apply.join("  ·  ")}\n` : "") +
      (persisted.length
        ? `Already persisted, so the next session starts there (${persisted.join(", ")} in ` +
          "~/.claude/settings.json).\n"
        : "") +
      "Then stop calling tools this turn and let the user answer. This is the ONLY effort " +
      "pause of the session — retrying always proceeds."
    );
  }
  return (
    "[vkm-effort] Calibración única de esta sesión.\n" +
    `El trabajo hecho hasta acá (${because}) pide /effort ${effort}` +
    (model ? ` con ${model}` : "") +
    `; la sesión corre /effort ${current ?? "desconocido"}` +
    (currentModel ? ` con ${currentModel}` : "") +
    ".\n" +
    (model
      ? `APLICALO YA, sin esperar a nadie: rehacé este edit con un sub-agente fijado a ese ` +
        `modelo (Task/Agent con model: "${model}") — un hook no puede cambiar el modelo de la ` +
        `sesión, pero el sub-agente sí corre en el que se le pasa.\n`
      : "") +
    (apply.length ? `Para TODA la sesión, el usuario escribe: ${apply.join("  ·  ")}\n` : "") +
    (persisted.length
      ? `Ya quedó persistido, así que la próxima sesión arranca ahí (${persisted.join(", ")} en ` +
        "~/.claude/settings.json).\n"
      : "") +
    "Después parate: no llames más herramientas este turno y dejá responder al usuario. Es la " +
    "ÚNICA pausa por esfuerzo de la sesión — al reintentar, sigue."
  );
}

/** Short line shown to the USER (systemMessage), which never reaches the model. */
export function userNotice(lang, { effort, model, persisted }) {
  const bits = [`/effort ${effort}`, model ? `/model ${model}` : null]
    .filter(Boolean)
    .join("  ·  ");
  if (lang === "en") {
    return (
      `vkm: this session's work reads as ${effort}${model ? ` / ${model}` : ""}. Apply now: ${bits}` +
      (persisted.length ? ` (saved as your default: ${persisted.join(", ")})` : "")
    );
  }
  return (
    `vkm: el trabajo de esta sesión da ${effort}${model ? ` / ${model}` : ""}. Aplicalo ya: ${bits}` +
    (persisted.length ? ` (guardado como tu default: ${persisted.join(", ")})` : "")
  );
}

/** How many edits may carry a retry before the deferred application gives up. */
export const MAX_APPLY_ATTEMPTS = 8;

/**
 * Opt-in (`VKM_EFFORT_APPLY=keys`): hand the decision to the sibling applier, which types
 * `/model` + `/effort` into the session — the only mid-session control that exists.
 *
 * Two constraints shape this, and they pull against each other:
 *
 *   - It must never take the foreground. Typing goes to whatever window is focused, so
 *     if the user is in another app the applier does NOTHING: pulling someone out of what
 *     they are doing is worse than an un-applied level, and typing `/model opus` into
 *     their editor is worse than both.
 *   - It must not need the user. So a skipped attempt is not the end: the decision stays
 *     `pendingApply` in the session sidecar and every later edit retries it, up to
 *     MAX_APPLY_ATTEMPTS. The moment the user is back in the Claude window it applies
 *     itself, with nothing typed by them.
 *
 * Why a synchronous, short-lived child rather than a detached watcher: the kit's own
 * launcher puts every hook in a Windows job object with KILL_ON_JOB_CLOSE (ADR-0078), so a
 * process that outlives the hook gets killed the moment the hook returns. A ~300ms probe
 * on at most eight edits is the version that actually survives to run.
 *
 * @returns {"typed"|"skipped"|"unavailable"}
 */
function applyByTyping({ effort, model, home }) {
  try {
    const script = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "apply-model-effort.mjs"
    );
    if (!fs.existsSync(script)) return "unavailable";
    const args = [script, "--effort", effort, "--log", path.join(sessionDir(home), "apply.log")];
    if (model) args.push("--model", model);
    // Through the windowless launcher when one is installed. NOT `windowsHide` and NOT
    // bare inheritance: this child spawns PowerShell, which can spawn a compiler, and
    // ADR-0078's whole point is that a parent with no console hands its console-subsystem
    // descendants a brand new VISIBLE one. A user in a full-screen game reported exactly
    // that — windows opening and closing in milliseconds, pulling them out of the game.
    // With no launcher installed it runs plainly and INHERITS the caller's console —
    // never `windowsHide`, which is the trap rather than the fix here.
    const launcher = path.join(home, ".claude", "bin", "vkm-runhidden.exe");
    const useLauncher = fs.existsSync(launcher);
    const r = spawnSync(
      useLauncher ? launcher : process.execPath,
      useLauncher ? [process.execPath, ...args, "--sync"] : [...args, "--sync"],
      { encoding: "utf8", timeout: 8000 }
    );
    return `${r.stdout ?? ""}`.includes("typed:") ? "typed" : "skipped";
  } catch {
    return "unavailable";
  }
}

/** Size of the edit being attempted, in characters, or 0 when not measurable. */
function editSize(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return 0;
  const parts = [toolInput.content, toolInput.new_string, toolInput.new_source];
  if (Array.isArray(toolInput.edits)) {
    for (const e of toolInput.edits) parts.push(e?.new_string);
  }
  return parts.reduce((n, p) => n + (typeof p === "string" ? p.length : 0), 0);
}

export function main(home = os.homedir()) {
  const lang = (process.argv[2] || "es").toLowerCase() === "en" ? "en" : "es";
  if (process.env.VKM_EFFORT_GATE === "0") return;

  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    return; // unparseable payload — defer to the normal permission flow
  }

  const toolName = typeof input?.tool_name === "string" ? input.tool_name : "";
  if (!SUBSTANTIVE_TOOLS.test(toolName)) return;
  if (typeof input?.agent_id === "string" && input.agent_id) return; // sub-agent: cannot answer

  const transcriptPath = typeof input?.transcript_path === "string" ? input.transcript_path : "";
  if (!transcriptPath) return; // nothing to judge from — fail open

  // No session id, no persistence and no pause. Claude Code always sends one; a payload
  // without it is a harness or a malformed call, and "once per session" is meaningless
  // when every caller shares the same bucket. Caught for real: the first run of the test
  // suite against this rewrite wrote `effortLevel` into the developer's own settings.json
  // through a fixture that never set `session_id`.
  const sessionId = typeof input?.session_id === "string" ? input.session_id.trim() : "";
  if (!sessionId) return;
  const state = readSessionState(sessionId, home);

  // A decision made while the user was in another window is not lost: retry it here, on
  // an edit they are not typing through, until it lands or the attempts run out. This is
  // the whole "without you having to do anything" half of the feature — the pause below
  // happens once, this keeps working afterwards.
  if (state.pendingApply && (state.applyAttempts ?? 0) < MAX_APPLY_ATTEMPTS) {
    const attempts = (state.applyAttempts ?? 0) + 1;
    const outcome = applyByTyping({ ...state.pendingApply, home });
    writeSessionState(
      sessionId,
      outcome === "typed"
        ? { pendingApply: null, applyAttempts: attempts, applied: state.pendingApply }
        : { applyAttempts: attempts },
      home
    );
  }

  if (state.paused) return; // one interruption per session, and it already happened

  const { substantiveBefore, files, stakes } = scanTranscript(transcriptPath);
  if (substantiveBefore === 0) return; // first substantive edit is always free

  const currentFile = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? null;
  const facts = {
    files,
    currentFile: typeof currentFile === "string" ? currentFile : null,
    editChars: editSize(input?.tool_input),
    stakes,
    substantiveBefore
  };
  const current = currentEffort(input);
  const currentModel = modelFamily(state.model);
  const { effort, model, why } = recommend(facts, { currentModel });

  // Effort matches and there is no model to propose: nothing to say. The common case, and
  // it must cost nothing — no write, no output, no pause.
  if (effort === current && !model) return;

  // The model is only ever persisted together with a visible interruption (see
  // persistDecision); the effort level rides along because the user is being told anyway.
  const persisted = persistDecision({ effort, model }, home);
  const wantTyping = process.env.VKM_EFFORT_APPLY === "keys";
  const applied = wantTyping ? applyByTyping({ effort, model, home }) : "off";
  writeSessionState(
    sessionId,
    {
      paused: true,
      effort,
      model: state.model ?? null,
      // Anything but a landed keystroke stays queued for the next edit to retry.
      pendingApply: wantTyping && applied !== "typed" ? { effort, model } : null,
      applyAttempts: wantTyping ? 1 : 0
    },
    home
  );

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason(lang, {
          effort,
          current,
          model,
          currentModel,
          why,
          persisted
        })
      },
      systemMessage: userNotice(lang, { effort, model, persisted })
    })
  );
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  try {
    main();
  } catch {
    // Never let a bug in this hook block a legitimate tool call.
  }
}
