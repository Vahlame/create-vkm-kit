#!/usr/bin/env node
/**
 * token-quality-ab orchestrator. Per mechanism: builds both conditions' subject
 * prompts, runs them (or emits them for an external orchestrator), grades
 * deterministically, prints per-cell mean±spread and the delta.
 *
 * Modes (mirror evals/skills-triggering/run.mjs):
 *   --mechanism <name> --emit-prompts       JSONL {id, condition, replica, prompt}
 *   --mechanism <name> --grade <answers>    grade {id, condition, replica, answer, model?}
 *   --mechanism <name> --models a,b --n N   end-to-end via subject-runner (claude -p)
 *
 * Implemented mechanisms live in tasks/<mechanism>.mjs exporting
 * { DIAG_TASKS|TASKS, subjectPrompt(task, condition), grade(task, answer) } with
 * conditions ["compacted","raw"] (A=first, B=second) or as declared by CONDITIONS.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSubject } from "../lib/subject-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONDITIONS = { "compact-tool-output": ["compacted", "raw"] };

async function loadMechanism(name) {
  const mod = await import(path.join(HERE, "tasks", `${name}.mjs`));
  const tasks = mod.DIAG_TASKS ?? mod.TASKS;
  if (!tasks) throw new Error(`tasks/${name}.mjs exports no task list`);
  return { tasks, subjectPrompt: mod.subjectPrompt, grade: mod.grade };
}

function stats(scores) {
  if (!scores.length) return { n: 0, mean: 0, spread: 0 };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const spread = Math.max(...scores) - Math.min(...scores);
  return { n: scores.length, mean: Math.round(mean * 10) / 10, spread };
}

export function report(cases, answers, conditions) {
  const byTask = new Map(cases.map((t) => [t.id, t]));
  const cells = new Map(); // `${model}|${condition}` -> scores[]
  for (const a of answers) {
    const task = byTask.get(a.id);
    if (!task) continue;
    const key = `${a.model ?? "?"}|${a.condition}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(a.score);
  }
  const lines = [];
  const models = [...new Set(answers.map((a) => a.model ?? "?"))];
  for (const m of models) {
    const A = stats(cells.get(`${m}|${conditions[0]}`) ?? []);
    const B = stats(cells.get(`${m}|${conditions[1]}`) ?? []);
    lines.push(
      `  ${m}: ${conditions[0]} mean=${A.mean} spread=${A.spread} n=${A.n} | ` +
        `${conditions[1]} mean=${B.mean} spread=${B.spread} n=${B.n} | delta(A-B)=${(A.mean - B.mean).toFixed(1)}`
    );
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  const mechanism = get("--mechanism");
  if (!mechanism) {
    console.error(
      "usage: run.mjs --mechanism <name> (--emit-prompts [--n N] | --grade <answers.jsonl> | --models a,b --n N)"
    );
    process.exit(2);
  }
  const { tasks, subjectPrompt, grade } = await loadMechanism(mechanism);
  const conditions = CONDITIONS[mechanism] ?? ["on", "off"];
  const n = Number(get("--n") ?? 3);

  if (args.includes("--emit-prompts")) {
    for (const t of tasks)
      for (const c of conditions)
        for (let r = 1; r <= n; r++)
          console.log(
            JSON.stringify({ id: t.id, condition: c, replica: r, prompt: subjectPrompt(t, c) })
          );
    return;
  }

  const gi = args.indexOf("--grade");
  if (gi !== -1) {
    const answers = readFileSync(args[gi + 1], "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((a) => ({
        ...a,
        score: grade(
          tasks.find((t) => t.id === a.id),
          a.answer
        )
      }));
    console.log(`token-quality-ab · ${mechanism} · graded ${answers.length} answers`);
    console.log(report(tasks, answers, conditions));
    for (const a of answers)
      console.error(
        JSON.stringify({
          id: a.id,
          condition: a.condition,
          replica: a.replica,
          model: a.model,
          score: a.score
        })
      );
    return;
  }

  const models = (get("--models") ?? "claude-haiku-4-5-20251001").split(",");
  const agentCmdBase = get("--agent-cmd") ?? "claude -p --output-format json --model";
  const answers = [];
  for (const model of models)
    for (const t of tasks)
      for (const c of conditions)
        for (let r = 1; r <= n; r++) {
          const { answer } = await runSubject({
            prompt: subjectPrompt(t, c),
            agentCmd: `${agentCmdBase} ${model}`
          });
          answers.push({
            id: t.id,
            condition: c,
            replica: r,
            model,
            answer,
            score: grade(t, answer)
          });
          process.stderr.write(".");
        }
  process.stderr.write("\n");
  console.log(`token-quality-ab · ${mechanism} · n=${n}/cell`);
  console.log(report(tasks, answers, conditions));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
