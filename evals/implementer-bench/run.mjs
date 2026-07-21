#!/usr/bin/env node
/**
 * implementer-bench: does the vkm-implementer AGENT framing (its real system
 * prompt, installed by the kit) beat a bare "implement this" on well-specified
 * tasks? Reuses discipline-bench's hidden-test graders verbatim — no new
 * instruments — with the task stated as a spec (the input vkm-implementer is
 * designed for, per its description: "ideally from /vkm-spec").
 *
 * Conditions: "implementer" (agent .md body as system framing) vs "bare".
 * Modes: --emit-prompts [--n N] | --grade <answers.jsonl> | --models a,b --n N.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSubject } from "../lib/subject-runner.mjs";

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

export const TASKS = ["parse-range", "dedupe-emails"];

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

/** @param {string} task @param {string} condition — "implementer" | "bare" */
export function subjectPrompt(task, condition) {
  const spec = specFor(task);
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

export function gradeSolution(task, answer, outName) {
  const code = String(answer).match(/```(?:js|javascript)?\n([\s\S]*?)```/)?.[1] ?? String(answer);
  const solDir = path.join(HERE, "solutions");
  mkdirSync(solDir, { recursive: true });
  const sol = path.join(solDir, outName);
  writeFileSync(sol, code);
  try {
    return JSON.parse(
      execFileSync("node", [path.join(DISC, "tasks", task, "grade.mjs"), sol], { encoding: "utf8" })
    ).score;
  } catch {
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  const n = Number(get("--n") ?? 3);
  const conditions = ["implementer", "bare"];

  if (args.includes("--emit-prompts")) {
    for (const t of TASKS)
      for (const c of conditions)
        for (let r = 1; r <= n; r++)
          console.log(
            JSON.stringify({ id: t, condition: c, replica: r, prompt: subjectPrompt(t, c) })
          );
    return;
  }
  const gi = args.indexOf("--grade");
  if (gi !== -1) {
    for (const line of readFileSync(args[gi + 1], "utf8")
      .split("\n")
      .filter(Boolean)) {
      const a = JSON.parse(line);
      const score = gradeSolution(
        a.id,
        a.answer,
        `${a.model ?? "x"}-${a.condition}-${a.replica}.mjs`
      );
      console.log(
        JSON.stringify({
          id: a.id,
          condition: a.condition,
          replica: a.replica,
          model: a.model,
          score
        })
      );
    }
    return;
  }

  const models = (get("--models") ?? "claude-haiku-4-5-20251001").split(",");
  for (const model of models)
    for (const t of TASKS)
      for (const c of conditions)
        for (let r = 1; r <= n; r++) {
          const { answer } = await runSubject({
            prompt: subjectPrompt(t, c),
            agentCmd: `${get("--agent-cmd") ?? "claude -p --output-format json --model"} ${model}`
          });
          const score = gradeSolution(t, answer, `${model}-${c}-${r}.mjs`);
          console.log(JSON.stringify({ id: t, condition: c, replica: r, model, score }));
        }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
