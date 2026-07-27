#!/usr/bin/env node
/**
 * token-quality-ab: does a token-saving mechanism cost quality?
 *
 * One mechanism per run. Implemented mechanisms live in `tasks/<mechanism>.mjs` and
 * export `{ DIAG_TASKS|TASKS, subjectPrompt(task, condition), grade(task, answer) }`.
 * Conditions default to ["on", "off"]; declare them in CONDITIONS when a mechanism
 * needs different labels.
 *
 *   node evals/token-quality-ab/run.mjs --mechanism compact-tool-output --emit-prompts
 *
 * Modes and reporting come from evals/lib/bench-cli.mjs. Because that report carries
 * cost alongside score (ADR-0065), a single run now answers both halves of this bench's
 * question — "did quality drop?" and "how much did it actually save?" — which
 * previously took two measurements or went unmeasured.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flag, runBenchCli } from "../lib/bench-cli.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Treatment first: the delta reads as "what turning the mechanism ON did". */
const CONDITIONS = { "compact-tool-output": ["compacted", "raw"] };

/**
 * @param {string} name
 * @returns {Promise<import("../lib/bench-cli.mjs").BenchSpec<{id: string}>>}
 */
export async function loadMechanism(name) {
  // pathToFileURL, not the bare path: on Windows `import("C:\\...")` throws
  // ERR_UNSUPPORTED_ESM_URL_SCHEME because 'c:' parses as a URL scheme. Every
  // `--mechanism` invocation failed there before this line.
  const mod = await import(pathToFileURL(path.join(HERE, "tasks", `${name}.mjs`)).href);
  const cases = mod.DIAG_TASKS ?? mod.TASKS;
  if (!cases) throw new Error(`tasks/${name}.mjs exports no task list`);
  return {
    name: `token-quality-ab · ${name}`,
    cases,
    conditions: CONDITIONS[name] ?? ["on", "off"],
    subjectPrompt: mod.subjectPrompt,
    grade: mod.grade,
    defaultN: 3
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const mechanism = flag(argv, "--mechanism");
  if (!mechanism) {
    console.error(
      "usage: run.mjs --mechanism <name> (--emit-prompts [--n N] | --grade <answers.jsonl> | --models a,b --n N)\n" +
        `mechanisms: ${Object.keys(CONDITIONS).join(", ")}`
    );
    return 2;
  }
  return runBenchCli(await loadMechanism(mechanism), argv);
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) process.exit(await main());
