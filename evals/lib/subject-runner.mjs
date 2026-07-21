#!/usr/bin/env node
/**
 * Shared subject runner for live-LLM benches (discipline-bench, token-quality-ab,
 * spec-bench): spawns an agent CLI headless per task, captures its answer + usage.
 *
 * The subject command is pluggable (`--agent-cmd`), default Claude Code headless:
 *   claude -p --output-format json
 * `codex exec` is compatible BY DESIGN (any CLI that reads a prompt on argv/stdin and
 * prints its answer) but UNVERIFIED — no Codex access where this was written; never
 * fabricate results for it.
 *
 * Isolation: each call runs with cwd = the task's fixture dir and (optionally) an
 * overridden HOME prepared by the caller — the installer-real way to A/B a mechanism
 * is: install the kit into a temp HOME, remove ONE mechanism, point HOME here.
 *
 * Zero deps. Exported for orchestrators; CLI mode for one-off runs.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

/**
 * @param {object} opts
 * @param {string} opts.prompt        the full subject prompt
 * @param {string} [opts.agentCmd]    e.g. "claude -p --output-format json --model claude-haiku-4-5-20251001"
 * @param {string} [opts.cwd]         fixture dir the subject works in
 * @param {string} [opts.home]        HOME override (prepared kit variant)
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{answer: string, usage: object|null, raw: string}>}
 */
export async function runSubject({ prompt, agentCmd, cwd, home, timeoutMs = 300_000 }) {
  const cmd = (agentCmd ?? "claude -p --output-format json").split(/\s+/);
  const env = { ...process.env };
  if (home) env.HOME = home;
  const { stdout } = await pExecFile(cmd[0], [...cmd.slice(1), prompt], {
    cwd,
    env,
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024
  });
  // claude -p --output-format json prints one JSON object with .result and .usage;
  // any other CLI: treat the whole stdout as the answer.
  try {
    const obj = JSON.parse(stdout);
    return { answer: obj.result ?? stdout, usage: obj.usage ?? null, raw: stdout };
  } catch {
    return { answer: stdout, usage: null, raw: stdout };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  const prompt = get("--prompt");
  if (!prompt) {
    console.error(
      'usage: subject-runner.mjs --prompt "<text>" [--agent-cmd "<cmd>"] [--cwd d] [--home d]'
    );
    process.exit(2);
  }
  const res = await runSubject({
    prompt,
    agentCmd: get("--agent-cmd"),
    cwd: get("--cwd"),
    home: get("--home")
  });
  console.log(JSON.stringify(res));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
