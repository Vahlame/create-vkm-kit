/**
 * The effort advisor (ADR-0081): decide, persist, tell the user ONCE — never interrupt.
 *
 * The property that matters most here is not which level it picks — it is that the hook
 * can never block a tool call. Two prior designs interrupted (ADR-0031 denied until a
 * model-authored block parsed — wedged four autonomous sessions; ADR-0080 denied exactly
 * once — still derailed autonomous iteration loops and charged a full model turn). So the
 * subprocess tests below pin "no deny exists" as hard as they pin the recommendation:
 * output may only ever carry a `systemMessage`, which renders to the user and costs the
 * model zero tokens.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentEffort,
  levelForScore,
  modelFamily,
  persistDecision,
  readSessionState,
  recommend,
  scanTranscript,
  scoreTask
} from "../src/hooks/guard-effort-gate.mjs";

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "hooks",
  "guard-effort-gate.mjs"
);

function transcriptWith(lines) {
  const dir = mkdtempSync(path.join(tmpdir(), "effort-gate-t-"));
  const p = path.join(dir, "transcript.jsonl");
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

const editOf = (file) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: file } }] }
});
const userSays = (text) => ({ type: "user", message: { content: text } });

/** A HOME with the settings.json a real install has. */
function tempHome(settings = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "effort-gate-h-"));
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  writeFileSync(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify(
      { model: "sonnet", effortLevel: "medium", theme: "dark-ansi", ...settings },
      null,
      2
    )
  );
  return home;
}

/** Run the real hook as Claude Code would; returns its parsed output or null. */
function runHook({ home, transcript, sessionId = "s1", payload = {}, env = {} }) {
  const out = execFileSync(process.execPath, [HOOK, "en"], {
    input: JSON.stringify({
      tool_name: "Edit",
      session_id: sessionId,
      transcript_path: transcript,
      tool_input: { file_path: "src/auth/login.ts", new_string: "x".repeat(500) },
      ...payload
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_EFFORT: "",
      CLAUDE_CODE_EFFORT: "",
      VKM_EFFORT_GATE: "",
      VKM_EFFORT_ALLOW_HAIKU: "",
      ...env
    }
  });
  return out.trim() ? JSON.parse(out) : null;
}

const settingsOf = (home) =>
  JSON.parse(readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));

// ── reading the session's real state ───────────────────────────────────────────────────

test("currentEffort prefers the payload's level over the environment", () => {
  assert.equal(currentEffort({ effort: { level: "xhigh" } }, { CLAUDE_EFFORT: "low" }), "xhigh");
  assert.equal(currentEffort({}, { CLAUDE_EFFORT: "high" }), "high");
  assert.equal(currentEffort({}, { CLAUDE_CODE_EFFORT: "LOW" }), "low");
  assert.equal(currentEffort({ effort: { level: "turbo" } }, {}), null);
  assert.equal(currentEffort({}, {}), null);
});

test("modelFamily normalizes ids, aliases and objects", () => {
  assert.equal(modelFamily("claude-opus-5"), "opus");
  assert.equal(modelFamily("sonnet"), "sonnet");
  assert.equal(modelFamily({ id: "claude-3-5-haiku-20241022" }), "haiku");
  assert.equal(modelFamily({ display_name: "Claude Fable 5" }), "fable");
  assert.equal(modelFamily(undefined), null);
  assert.equal(modelFamily("gpt-4"), null);
});

test("scanTranscript counts substantive edits, collects files and reads the user's stakes", () => {
  const t = transcriptWith([
    userSays("esto va a producción hoy"),
    editOf("src/auth/login.ts"),
    editOf("src/auth/login.ts"),
    editOf("README.md")
  ]);
  const s = scanTranscript(t);
  assert.equal(s.substantiveBefore, 3);
  assert.deepEqual(s.files, ["src/auth/login.ts", "README.md"], "files are deduped, in order");
  assert.equal(s.stakes, 1);
});

test("scanTranscript ignores tool_result entries, which are typed as user turns", () => {
  const t = transcriptWith([
    editOf("a.ts"),
    {
      type: "user",
      message: { content: [{ type: "tool_result", content: "deploy to production" }] }
    }
  ]);
  assert.equal(scanTranscript(t).stakes, 0, "a tool result is not the user talking");
});

// ── the recommendation ─────────────────────────────────────────────────────────────────

test("a security path outranks a small edit; prose-only work sinks", () => {
  const risky = scoreTask({ files: ["src/auth/session.ts"], editChars: 50 });
  assert.ok(risky.score >= 35, `expected high+, got ${risky.score}`);
  assert.ok(risky.why.some((w) => /security/.test(w)));

  const prose = scoreTask({ files: ["docs/README.md"], editChars: 40 });
  assert.equal(levelForScore(prose.score), "low");
});

test("breadth and the user's own words move the level", () => {
  const one = scoreTask({ files: ["src/m0.ts"] });
  const many = scoreTask({ files: Array.from({ length: 13 }, (_, i) => `src/m${i}.ts`) });
  assert.ok(many.score > one.score, "13 files must outrank 1");
  assert.deepEqual(
    [levelForScore(one.score), levelForScore(many.score)],
    ["medium", "high"],
    "the breadth bonus must cross a level boundary, not just move the number"
  );
  const urgent = scoreTask({ files: ["src/a.ts"], stakes: 2 });
  const calm = scoreTask({ files: ["src/a.ts"], stakes: -2 });
  assert.ok(urgent.score > calm.score, "high-stakes wording must outrank low-stakes wording");
});

test("fable is never recommended and never overridden", () => {
  const risky = { files: ["src/auth/login.ts"] };
  const onFable = recommend(risky, { currentModel: "fable" });
  assert.equal(onFable.model, null, "a deliberate fable session is left alone");

  const onSonnet = recommend(risky, { currentModel: "sonnet" });
  assert.equal(onSonnet.model, "opus");
  for (const facts of [risky, { files: ["a.md"], editChars: 10 }, { files: [] }]) {
    for (const cur of ["haiku", "sonnet", "opus"]) {
      assert.notEqual(recommend(facts, { currentModel: cur }).model, "fable");
    }
  }
});

test("no model is named when the current one is unknown, and downgrades are opt-in", () => {
  assert.equal(recommend({ files: ["src/auth/x.ts"] }, { currentModel: null }).model, null);

  const trivial = { files: ["docs/a.md"], editChars: 20 };
  assert.equal(
    recommend(trivial, { currentModel: "opus", env: {} }).model,
    null,
    "a hook must not quietly drop the user to a smaller model"
  );
  assert.equal(
    recommend(trivial, { currentModel: "opus", env: { VKM_EFFORT_ALLOW_HAIKU: "1" } }).model,
    "haiku"
  );
});

// ── persistence ────────────────────────────────────────────────────────────────────────

test("persistDecision writes only what changed and keeps the rest of settings.json", () => {
  const home = tempHome({ effortLevel: "medium", model: "sonnet" });
  const changed = persistDecision({ effort: "xhigh", model: "opus" }, home);
  assert.deepEqual(changed.sort(), ["effortLevel", "model"]);

  const after = settingsOf(home);
  assert.equal(after.effortLevel, "xhigh");
  assert.equal(after.model, "opus");
  assert.equal(after.theme, "dark-ansi", "an unrelated key was lost");

  assert.deepEqual(persistDecision({ effort: "xhigh", model: "opus" }, home), [], "idempotent");
  assert.equal(
    readdirSync(path.join(home, ".claude")).filter((f) => f.includes("vkm-tmp")).length,
    0,
    "left a temp file behind"
  );
});

test("persistDecision never invents a settings.json it cannot read", () => {
  const home = mkdtempSync(path.join(tmpdir(), "effort-gate-nohome-"));
  assert.deepEqual(persistDecision({ effort: "high" }, home), []);
});

// ── the hook, end to end ───────────────────────────────────────────────────────────────

test("the first substantive edit of a session is free", () => {
  const home = tempHome();
  const out = runHook({ home, transcript: transcriptWith([userSays("hola")]) });
  assert.equal(out, null);
  assert.equal(settingsOf(home).effortLevel, "medium", "an untouched session was written to");
});

test("a mismatch advises once: NO deny, user notice + persisted decision", () => {
  const home = tempHome({ effortLevel: "medium", model: "sonnet" });
  const transcript = transcriptWith([
    userSays("esto se va a producción"),
    editOf("src/auth/login.ts"),
    editOf("src/auth/session.ts")
  ]);
  const out = runHook({ home, transcript, env: { CLAUDE_EFFORT: "low" } });

  assert.equal(
    out?.hookSpecificOutput,
    undefined,
    "the advisor must have NO permission opinion — a deny is the failure mode it replaced"
  );
  assert.match(out.systemMessage, /\/effort (high|xhigh|max)/);
  assert.match(out.systemMessage, /Apply now/);

  const after = settingsOf(home);
  assert.match(after.effortLevel, /^(high|xhigh|max)$/, "the decision was not persisted");
  assert.equal(readSessionState("s1", home).noticed, true);
});

test("the SAME session is never noticed twice, whatever the transcript says", () => {
  const home = tempHome({ effortLevel: "medium" });
  const transcript = transcriptWith([
    userSays("producción, urgente"),
    editOf("src/auth/login.ts"),
    editOf("src/auth/session.ts")
  ]);
  assert.ok(
    runHook({ home, transcript, env: { CLAUDE_EFFORT: "low" } }),
    "expected a first notice"
  );

  // Exactly the state an autonomous session iterates in: nothing changed between edits.
  const second = runHook({ home, transcript, env: { CLAUDE_EFFORT: "low" } });
  assert.equal(second, null, "a repeated notice would spam every later edit of the session");
});

test("a pre-rewrite sidecar with `paused` is honored — upgrades never re-notice", () => {
  const home = tempHome({ effortLevel: "medium" });
  const transcript = transcriptWith([
    userSays("producción, urgente"),
    editOf("src/auth/login.ts"),
    editOf("src/auth/session.ts")
  ]);
  mkdirSync(path.join(home, ".vkm", "effort-gate"), { recursive: true });
  writeFileSync(
    path.join(home, ".vkm", "effort-gate", "s1.json"),
    JSON.stringify({ paused: true })
  );
  assert.equal(runHook({ home, transcript, env: { CLAUDE_EFFORT: "low" } }), null);
});

test("sub-agents and the kill switch are exempt", () => {
  const transcript = transcriptWith([
    userSays("producción"),
    editOf("src/auth/login.ts"),
    editOf("src/auth/session.ts")
  ]);
  assert.equal(
    runHook({
      home: tempHome(),
      transcript,
      sessionId: "sub",
      payload: { agent_id: "agent_1" },
      env: { CLAUDE_EFFORT: "low" }
    }),
    null
  );
  assert.equal(
    runHook({
      home: tempHome(),
      transcript,
      sessionId: "off",
      env: { CLAUDE_EFFORT: "low", VKM_EFFORT_GATE: "0" }
    }),
    null
  );
});

test("the CDP path is skipped silently when no debugging port is open", async () => {
  const { applyViaCdp, findCdpTarget } = await import("../src/hooks/apply-model-effort.mjs");
  // 9-thousand-something with nothing on it: the state of every machine that did not run
  // scripts/claude-desktop-debug.ps1, which must degrade to the keyboard path, not throw.
  assert.equal(await findCdpTarget(59999), null);
  assert.equal(await applyViaCdp(["/effort high"], { port: 59999 }), null);
});

test("the CDP sequence focuses the prompt before typing and submits with a real key", async () => {
  const { cdpCommandSequence } = await import("../src/hooks/apply-model-effort.mjs");
  const seq = cdpCommandSequence("/model opus", 1);

  assert.deepEqual(
    seq.map((s) => s.method),
    ["Runtime.evaluate", "Input.insertText", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent"]
  );
  assert.match(seq[0].params.expression, /contenteditable="true"/);
  assert.match(seq[0].params.expression, /\.focus\(\)/, "insertText goes nowhere unfocused");
  assert.equal(seq[1].params.text, "/model opus");
  assert.deepEqual(
    seq.slice(2).map((s) => [s.params.type, s.params.key]),
    [
      ["keyDown", "Enter"],
      ["keyUp", "Enter"]
    ],
    "a React send handler listens for a key event, not for a changed DOM"
  );
  assert.deepEqual(
    seq.map((s) => s.id),
    [1, 2, 3, 4],
    "ids must not collide across commands"
  );
});

test("the typing applier never steals focus and never types an unvetted string", async () => {
  const { commandsFor, powershellScript } = await import("../src/hooks/apply-model-effort.mjs");

  assert.deepEqual(commandsFor({ model: "opus", effort: "xhigh" }), [
    "/model opus",
    "/effort xhigh"
  ]);
  assert.deepEqual(commandsFor({ model: "fable", effort: "max" }), ["/effort max"], "fable is out");
  assert.deepEqual(
    commandsFor({ model: "opus; rm -rf /", effort: "'; exit" }),
    [],
    "anything outside the closed sets must never reach a keystroke stream"
  );

  const ps = powershellScript(commandsFor({ model: "opus", effort: "high" }));
  assert.match(ps, /GetForegroundWindow/, "must check what is in front before typing");
  assert.match(ps, /if \(\$name -ne 'claude'\) \{ Write-Output .*exit 0 \}/);
  for (const stealer of ["SetForegroundWindow", "AppActivate", "ShowWindow", "BringToFront"]) {
    assert.ok(
      !ps.includes(stealer),
      `the applier must never pull the user out of the app they are in (found ${stealer})`
    );
  }
});

test("a session already at the right level is never touched", () => {
  const home = tempHome({ effortLevel: "low" });
  const transcript = transcriptWith([
    userSays("arreglá el typo"),
    editOf("docs/a.md"),
    editOf("docs/b.md")
  ]);
  const out = runHook({
    home,
    transcript,
    payload: { tool_input: { file_path: "docs/c.md", new_string: "hi" } },
    env: { CLAUDE_EFFORT: "low" }
  });
  assert.equal(out, null);
  assert.equal(settingsOf(home).effortLevel, "low", "a no-op decision still wrote to disk");
  assert.equal(
    readSessionState("s1", home).noticed,
    undefined,
    "a no-op decision burned the notice"
  );
});

test("simple work persists a CHEAPER effort level for the next session", () => {
  const home = tempHome({ effortLevel: "xhigh" });
  const transcript = transcriptWith([
    userSays("arreglá el typo rápido"),
    editOf("docs/a.md"),
    editOf("docs/b.md")
  ]);
  const out = runHook({
    home,
    transcript,
    payload: { tool_input: { file_path: "docs/c.md", new_string: "hi" } },
    env: { CLAUDE_EFFORT: "xhigh" }
  });
  assert.ok(out?.systemMessage, "a downshift is advice the user should see once");
  assert.equal(out.hookSpecificOutput, undefined, "advice must never carry a deny");
  assert.equal(
    settingsOf(home).effortLevel,
    "low",
    "the savings channel IS the persisted downshift"
  );
});
