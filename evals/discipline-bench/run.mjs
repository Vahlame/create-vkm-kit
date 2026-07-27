#!/usr/bin/env node
/**
 * discipline-bench: does the vkm-discipline skill beat a bare prompt on tasks whose
 * grade comes from hidden tests?
 *
 * Conditions: "discipline" (SKILL.md core + domains/coding.md prepended) vs "stock"
 * (PROMPT alone). Grading: the task's own grade.mjs — execution-graded, never a rubric.
 *
 *   node evals/discipline-bench/run.mjs --models claude-haiku-4-5-20251001 --n 5
 *   node evals/discipline-bench/run.mjs --emit-prompts --n 5   # external subjects
 *
 * The Agent-tool method (README.md) and this runner are the same design — subjects see
 * only the prompt; solutions are saved under solutions/ and graded after.
 *
 * Modes and reporting come from evals/lib/bench-cli.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBenchCli } from "../lib/bench-cli.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(
  HERE,
  "..",
  "..",
  "packages",
  "create-vkm-kit",
  "templates",
  "skills",
  "vkm-discipline"
);

/** Every directory under tasks/ is a task; its id is its directory name. */
export function taskCases() {
  return readdirSync(path.join(HERE, "tasks"))
    .sort()
    .map((id) => ({ id }));
}

/** @param {{id:string}} t @param {string} condition — "discipline" | "stock" */
export function subjectPrompt(t, condition) {
  const dir = path.join(HERE, "tasks", t.id);
  const promptFile = existsSync(path.join(dir, "PROMPT.md")) ? "PROMPT.md" : "PROMPT-underspec.md";
  const taskText = readFileSync(path.join(dir, promptFile), "utf8");
  const head = "Return your solution as a SINGLE fenced js code block (ESM) and nothing else.\n\n";
  if (condition === "stock") return head + taskText;
  const skillBody = readFileSync(path.join(SKILL, "SKILL.md"), "utf8")
    .split("---\n")
    .slice(2)
    .join("---\n");
  const coding = readFileSync(path.join(SKILL, "domains", "coding.md"), "utf8");
  return `${head}=== Execution discipline you follow (loaded skill) ===\n${skillBody}\n${coding}\n=== Task ===\n${taskText}`;
}

/**
 * Extract the fenced solution, write it under solutions/, run the task's hidden tests.
 * A grader that throws scores 0 — an unrunnable answer is a failed answer.
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
      execFileSync("node", [path.join(HERE, "tasks", t.id, "grade.mjs"), sol], { encoding: "utf8" })
    ).score;
  } catch {
    return 0;
  }
}

export const spec = {
  name: "discipline-bench",
  get cases() {
    return taskCases();
  },
  // Treatment first, so a positive delta means "the skill helped" — the same sign
  // convention as every other bench. This runner used to list stock first.
  conditions: /** @type {[string, string]} */ (["discipline", "stock"]),
  subjectPrompt,
  grade,
  defaultN: 3
};

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) process.exit(await runBenchCli({ ...spec, cases: spec.cases }));
