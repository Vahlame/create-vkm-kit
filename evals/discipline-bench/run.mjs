#!/usr/bin/env node
/**
 * discipline-bench orchestrator over the shared subject runner (claude -p headless).
 * Conditions: stock (PROMPT alone) vs discipline (SKILL.md core + domains/coding.md
 * prepended). Grading: the task's own hidden-test grade.mjs (execution-graded).
 *
 *   node evals/discipline-bench/run.mjs --models claude-haiku-4-5-20251001 --n 5
 *   node evals/discipline-bench/run.mjs --emit-prompts --n 5   # external subjects
 *
 * The Agent-tool method (README.md) and this runner are the same design — subjects
 * see only the prompt; solutions are saved under solutions/ and graded after.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSubject } from "../lib/subject-runner.mjs";

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

function taskIds() {
  return readdirSync(path.join(HERE, "tasks")).sort();
}
function promptFor(task, condition) {
  const dir = path.join(HERE, "tasks", task);
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
function gradeSolution(task, answer, outName) {
  const code = String(answer).match(/```(?:js|javascript)?\n([\s\S]*?)```/)?.[1] ?? String(answer);
  const solDir = path.join(HERE, "solutions");
  mkdirSync(solDir, { recursive: true });
  const sol = path.join(solDir, outName);
  writeFileSync(sol, code);
  try {
    return JSON.parse(
      execFileSync("node", [path.join(HERE, "tasks", task, "grade.mjs"), sol], { encoding: "utf8" })
    ).score;
  } catch {
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  const n = Number(get("--n") ?? 3);
  const conditions = ["stock", "discipline"];

  if (args.includes("--emit-prompts")) {
    for (const t of taskIds())
      for (const c of conditions)
        for (let r = 1; r <= n; r++)
          console.log(JSON.stringify({ id: t, condition: c, replica: r, prompt: promptFor(t, c) }));
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
  const rows = [];
  for (const model of models)
    for (const t of taskIds())
      for (const c of conditions)
        for (let r = 1; r <= n; r++) {
          const { answer } = await runSubject({
            prompt: promptFor(t, c),
            agentCmd: `${get("--agent-cmd") ?? "claude -p --output-format json --model"} ${model}`
          });
          const score = gradeSolution(t, answer, `${model}-${c}-${r}.mjs`);
          rows.push({ model, task: t, condition: c, replica: r, score });
          process.stderr.write(".");
        }
  process.stderr.write("\n");
  for (const model of models)
    for (const t of taskIds())
      for (const c of conditions) {
        const cell = rows
          .filter((x) => x.model === model && x.task === t && x.condition === c)
          .map((x) => x.score);
        if (cell.length)
          console.log(
            `${model} · ${t} · ${c}: [${cell.join(",")}] mean=${(cell.reduce((a, b) => a + b, 0) / cell.length).toFixed(1)}`
          );
      }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
