#!/usr/bin/env node
/**
 * implementer-bench: does the vkm-implementer AGENT framing (its real system prompt,
 * installed by the kit) beat a bare "implement this" on well-specified tasks? Reuses
 * discipline-bench's hidden-test graders verbatim — no new instruments — with the task
 * stated as a spec (the input vkm-implementer is designed for, per its description:
 * "ideally from /vkm-spec").
 *
 * Conditions: "implementer" (agent .md body as system framing) vs "bare".
 * Modes and reporting come from evals/lib/bench-cli.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBenchCli } from "../lib/bench-cli.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISC = path.join(HERE, "..", "discipline-bench");
const AGENT_MD = path.join(
  HERE,
  "..",
  "..",
  "packages",
  "create-vkm-kit",
  "templates",
  "agents",
  "vkm-implementer.md"
);

export const TASKS = ["parse-range", "dedupe-emails", "parse-duration", "merge-intervals"].map(
  (id) => ({ id })
);

function specFor(task) {
  // The task's explicit PROMPT (or underspec fallback) reframed as the spec the
  // implementer receives — same rules, spec-shaped envelope.
  const dir = path.join(DISC, "tasks", task);
  const promptFile = existsSync(path.join(dir, "PROMPT.md")) ? "PROMPT.md" : "PROMPT-underspec.md";
  const body = readFileSync(path.join(dir, promptFile), "utf8");
  return [
    `# Spec: ${task}`,
    "",
    "## user_intent",
    "",
    "Deliver the function below exactly as specified; it will be verified by tests you cannot see.",
    "",
    "## functional_requirements (verbatim task statement)",
    "",
    body,
    "",
    "## acceptance_criteria",
    "",
    "- [ ] The exported function satisfies every rule above, including edge cases.",
    "- [ ] Returned as a single fenced js code block (ESM), nothing else."
  ].join("\n");
}

/** @param {{id:string}} t @param {string} condition — "implementer" | "bare" */
export function subjectPrompt(t, condition) {
  const spec = specFor(t.id);
  if (condition === "bare") {
    return `Return your solution as a SINGLE fenced js code block (ESM) and nothing else.\n\n${spec}`;
  }
  const agentBody = readFileSync(AGENT_MD, "utf8").split("---\n").slice(2).join("---\n");
  return [
    "=== Your operating contract (you are this agent) ===",
    agentBody.trim(),
    "",
    "=== Assignment ===",
    "Return your solution as a SINGLE fenced js code block (ESM) and nothing else.",
    "",
    spec
  ].join("\n");
}

/**
 * @param {{id:string}} t
 * @param {string} answer
 * @param {{model?:string, condition:string, replica:number}} meta
 */
export function grade(t, answer, meta) {
  const code = String(answer).match(/```(?:js|javascript)?\n([\s\S]*?)```/)?.[1] ?? String(answer);
  const solDir = path.join(HERE, "solutions");
  mkdirSync(solDir, { recursive: true });
  const sol = path.join(solDir, `${meta.model ?? "x"}-${meta.condition}-${meta.replica}.mjs`);
  writeFileSync(sol, code);
  try {
    return JSON.parse(
      execFileSync("node", [path.join(DISC, "tasks", t.id, "grade.mjs"), sol], { encoding: "utf8" })
    ).score;
  } catch {
    return 0;
  }
}

export const spec = {
  name: "implementer-bench",
  cases: TASKS,
  conditions: /** @type {[string, string]} */ (["implementer", "bare"]),
  subjectPrompt,
  grade,
  defaultN: 3
};

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) process.exit(await runBenchCli(spec));
