/**
 * Effort-gate auto-match (ADR-0031 amendment): the gate detects the session's CURRENT
 * effort (CLAUDE_EFFORT in the hook's inherited env) and opens itself when the model's
 * proposed level equals it — a matching suggestion needs no user pause. A mismatch, an
 * undetectable current effort, or a template-only proposal keep the original behavior.
 * Runs the real hook as a subprocess (stdin payload contract), plus unit checks on the
 * exported pieces.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentEffort, scanTranscript } from "../src/hooks/guard-effort-gate.mjs";

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "hooks",
  "guard-effort-gate.mjs"
);

function transcriptWith(lines) {
  const dir = mkdtempSync(path.join(tmpdir(), "effort-gate-"));
  const p = path.join(dir, "transcript.jsonl");
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

const editTurn = {
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Edit", input: {} }] }
};
function proposalTurn(level) {
  return {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text:
            "[!] EFFORT RECOMMENDATION\n- Task: x\n" +
            `- Suggested level: /effort ${level}\n- Reason: y`
        }
      ]
    }
  };
}

/** Run the real hook; returns the parsed deny payload, or null when it allowed. */
function runHook(transcriptPath, env) {
  const out = execFileSync("node", [HOOK, "en"], {
    input: JSON.stringify({ tool_name: "Edit", transcript_path: transcriptPath }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_EFFORT: "", CLAUDE_CODE_EFFORT: "", ...env }
  });
  return out.trim() ? JSON.parse(out) : null;
}

test("currentEffort reads CLAUDE_EFFORT and rejects unknown values", () => {
  assert.equal(currentEffort({ CLAUDE_EFFORT: "high" }), "high");
  assert.equal(currentEffort({ CLAUDE_EFFORT: "XHIGH" }), "xhigh");
  assert.equal(currentEffort({ CLAUDE_CODE_EFFORT: "low" }), "low");
  assert.equal(currentEffort({ CLAUDE_EFFORT: "turbo" }), null);
  assert.equal(currentEffort({}), null);
});

test("scanTranscript captures the proposed level; the template placeholder does not", () => {
  const s1 = scanTranscript(transcriptWith([editTurn, proposalTurn("high")]));
  assert.equal(s1.pending, true);
  assert.equal(s1.suggested, "high");
  const template = {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "[!] EFFORT RECOMMENDATION\n- Suggested level: /effort <low|medium|high|xhigh|max>"
        }
      ]
    }
  };
  const s2 = scanTranscript(transcriptWith([editTurn, template]));
  assert.equal(s2.pending, true);
  assert.equal(s2.suggested, null);
});

test("proposal matching the current session effort opens the gate (no deny)", () => {
  const t = transcriptWith([editTurn, proposalTurn("high")]);
  assert.equal(runHook(t, { CLAUDE_EFFORT: "high" }), null);
});

test("proposal differing from the current effort still pauses", () => {
  const t = transcriptWith([editTurn, proposalTurn("max")]);
  const deny = runHook(t, { CLAUDE_EFFORT: "high" });
  assert.equal(deny?.hookSpecificOutput?.permissionDecision, "deny");
});

test("undetectable current effort keeps the original pause behavior", () => {
  const t = transcriptWith([editTurn, proposalTurn("high")]);
  const deny = runHook(t, {});
  assert.equal(deny?.hookSpecificOutput?.permissionDecision, "deny");
});

test("no proposal yet: deny message advertises the detected current effort", () => {
  const t = transcriptWith([editTurn, editTurn]);
  const deny = runHook(t, { CLAUDE_EFFORT: "medium" });
  assert.equal(deny?.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(deny.hookSpecificOutput.permissionDecisionReason, /\/effort medium/);
  assert.match(deny.hookSpecificOutput.permissionDecisionReason, /opens automatically/);
});

test("a real user reply still satisfies the gate regardless of levels (unchanged)", () => {
  const t = transcriptWith([
    editTurn,
    proposalTurn("max"),
    { type: "user", message: { content: "ok, go" } }
  ]);
  assert.equal(runHook(t, { CLAUDE_EFFORT: "high" }), null);
});
