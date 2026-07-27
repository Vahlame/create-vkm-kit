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
import { pathToFileURL } from "node:url";

const pExecFile = promisify(execFile);

/**
 * Longest command line the platform will accept, in characters.
 *
 * Windows `CreateProcess` caps `lpCommandLine` at 32,767 **including** the executable
 * path and every other argument. This is not theoretical: `design-bench` already emits
 * a 26,852-character prompt (it injects SKILL.md + direction.md + foundations.md), which
 * is 82% of the ceiling, and those files grow every release. The failure mode without a
 * guard is a bare `spawn ... ENAMETOOLONG` — or on Windows something less legible —
 * hundreds of live model calls into a run.
 *
 * POSIX `ARG_MAX` is far larger (~2 MB on Linux, 256 KB on macOS); 128 KB is a
 * conservative floor that no bench approaches.
 */
const ARGV_LIMIT = process.platform === "win32" ? 32_767 : 128 * 1024;

/**
 * Normalized per-run cost (ADR-0065). Every bench measured Δquality and none measured
 * what that quality cost, so "the kit wins" and "the kit wins while tripling tool
 * calls" were the same reported result. `usage` was already returned here and every
 * caller destructured `{ answer }` and dropped it — the data arrived and was thrown
 * away at the call site.
 *
 * `wallClockMs` is measured by this process, so it is present for ANY agent CLI.
 * The token and turn fields come from `claude -p --output-format json`; a CLI that
 * reports nothing yields nulls, never zeros. That distinction is load-bearing: a
 * zero would silently average into a cost claim as "this run was free".
 *
 * @typedef {object} SubjectCost
 * @property {number|null} inputTokens
 * @property {number|null} outputTokens
 * @property {number|null} cacheReadTokens
 * @property {number|null} cacheCreationTokens
 * @property {number|null} totalTokens        input + output (cache excluded — it is
 *                                            billed differently and would double-count)
 * @property {number|null} turns              assistant turns; the closest available
 *                                            proxy for tool-call count
 * @property {number|null} costUsd
 * @property {number} wallClockMs
 */

/**
 * @param {object|null} obj parsed agent JSON, when the CLI produced any
 * @param {number} wallClockMs
 * @returns {SubjectCost}
 */
function costOf(obj, wallClockMs) {
  const u = obj?.usage ?? null;
  const num = (v) => (typeof v === "number" ? v : null);
  const input = num(u?.input_tokens);
  const output = num(u?.output_tokens);
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: num(u?.cache_read_input_tokens),
    cacheCreationTokens: num(u?.cache_creation_input_tokens),
    totalTokens: input === null && output === null ? null : (input ?? 0) + (output ?? 0),
    turns: num(obj?.num_turns),
    costUsd: num(obj?.total_cost_usd),
    wallClockMs
  };
}

/**
 * @param {object} opts
 * @param {string} opts.prompt        the full subject prompt
 * @param {string} [opts.agentCmd]    e.g. "claude -p --output-format json --model claude-haiku-4-5-20251001".
 *                                    Split on whitespace, so no single argument may
 *                                    contain a space (the benches only pass flags and
 *                                    model ids, which is why this has never bitten).
 * @param {string} [opts.cwd]         fixture dir the subject works in
 * @param {string} [opts.home]        HOME override (prepared kit variant)
 * @param {number} [opts.timeoutMs]
 * @param {"argv"|"stdin"} [opts.promptVia]
 *        How the prompt reaches the subject. Defaults to `"argv"` — the path every
 *        committed `RESULTS.md` was produced with, so it stays the default. `"stdin"`
 *        writes the prompt to the child's stdin and passes no positional argument,
 *        which sidesteps `ARGV_LIMIT` entirely; it is opt-in because whether a given
 *        agent CLI treats piped stdin as *the prompt* or as *extra context* is that
 *        CLI's business, and guessing wrong would silently change what was measured.
 * @returns {Promise<{answer: string, usage: object|null, cost: SubjectCost, raw: string}>}
 */
export async function runSubject({
  prompt,
  agentCmd,
  cwd,
  home,
  timeoutMs = 300_000,
  promptVia = "argv"
}) {
  const cmd = (agentCmd ?? "claude -p --output-format json").split(/\s+/);
  const env = { ...process.env };
  if (home) env.HOME = home;
  const viaStdin = promptVia === "stdin";
  const args = viaStdin ? cmd.slice(1) : [...cmd.slice(1), prompt];
  if (!viaStdin) {
    // Fail here, with the numbers, rather than let the OS reject the spawn opaquely.
    const commandLineChars = [cmd[0], ...args].reduce((a, s) => a + s.length + 1, 0);
    if (commandLineChars > ARGV_LIMIT) {
      throw new Error(
        `subject prompt does not fit on the command line: ${commandLineChars} chars > ` +
          `${ARGV_LIMIT} (${process.platform}). Pass promptVia: "stdin" (CLI flag ` +
          `--prompt-via stdin) if your agent CLI reads its prompt from stdin.`
      );
    }
  }
  const startedAt = process.hrtime.bigint();
  const child = pExecFile(cmd[0], args, {
    cwd,
    env,
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024
  });
  if (viaStdin) {
    child.child.stdin?.end(prompt);
  }
  const { stdout } = await child;
  const wallClockMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  // claude -p --output-format json prints one JSON object with .result and .usage;
  // any other CLI: treat the whole stdout as the answer.
  try {
    const obj = JSON.parse(stdout);
    return {
      answer: obj.result ?? stdout,
      usage: obj.usage ?? null,
      cost: costOf(obj, wallClockMs),
      raw: stdout
    };
  } catch {
    return { answer: stdout, usage: null, cost: costOf(null, wallClockMs), raw: stdout };
  }
}

/**
 * Sum a cell's runs into one cost row. A field is null unless EVERY run reported it —
 * averaging a cell where half the runs reported nothing produces a number that looks
 * like a measurement and isn't.
 *
 * Takes `Partial<SubjectCost>` on purpose: tolerating absent fields is the whole job,
 * so the signature says so rather than promising inputs it never requires.
 * @param {Partial<SubjectCost>[]} costs
 */
export function aggregateCost(costs) {
  const field = (k) => {
    const vals = costs.map((c) => c?.[k]);
    if (!vals.length || vals.some((v) => typeof v !== "number")) return null;
    return vals.reduce((a, v) => a + v, 0);
  };
  const meanField = (k) => {
    const total = field(k);
    return total === null ? null : total / costs.length;
  };
  return {
    n: costs.length,
    meanTotalTokens: meanField("totalTokens"),
    meanOutputTokens: meanField("outputTokens"),
    meanTurns: meanField("turns"),
    meanWallClockMs: meanField("wallClockMs"),
    totalCostUsd: field("costUsd")
  };
}

/**
 * Re-key a cell's cost into the exact shape `vkm-doctor` aggregates local OTLP
 * telemetry into (`{ input, output, cacheRead, cacheCreation }`, `costUSD` —
 * `packages/vkm-doctor/src/doctor.mjs:38`). This is the join ADR-0065 needs: bench
 * cost and real-session cost become the same units, so "what the kit costs in the
 * lab" and "what it costs in use" can be compared instead of merely coexisting.
 *
 * Sums, not means — the doctor reports totals.
 * @param {Partial<SubjectCost>[]} costs
 */
export function toTelemetryTotals(costs) {
  const sum = (k) => {
    const vals = costs.map((c) => c?.[k]);
    if (!vals.length || vals.some((v) => typeof v !== "number")) return null;
    return vals.reduce((a, v) => a + v, 0);
  };
  return {
    input: sum("inputTokens"),
    output: sum("outputTokens"),
    cacheRead: sum("cacheReadTokens"),
    cacheCreation: sum("cacheCreationTokens"),
    costUSD: sum("costUsd")
  };
}

/**
 * One-line cost summary for a cell. Prints `cost=unreported` rather than zeros when
 * the agent CLI gave no usage — the reader must be able to tell "free" from "unknown".
 * @param {Partial<ReturnType<typeof aggregateCost>>|null} cost
 */
export function formatCost(cost) {
  if (!cost || cost.meanTotalTokens === null) {
    const ms = cost?.meanWallClockMs;
    return `cost=unreported${typeof ms === "number" ? ` wall=${(ms / 1000).toFixed(1)}s` : ""}`;
  }
  const parts = [`tok=${Math.round(cost.meanTotalTokens)}`];
  if (cost.meanOutputTokens !== null) parts.push(`out=${Math.round(cost.meanOutputTokens)}`);
  if (cost.meanTurns !== null) parts.push(`turns=${cost.meanTurns.toFixed(1)}`);
  if (cost.meanWallClockMs !== null)
    parts.push(`wall=${(cost.meanWallClockMs / 1000).toFixed(1)}s`);
  if (cost.totalCostUsd !== null) parts.push(`usd=${cost.totalCostUsd.toFixed(4)}`);
  return parts.join(" ");
}

/**
 * The Δquality / Δtokens column ADR-0065 requires: quality bought per 1,000 extra
 * tokens. Beating the baseline while spending far more is not the same result as
 * beating it for free, and one number has to say which happened.
 *
 * Returns null when either arm reported no tokens (an unreported cost is unknown,
 * not zero), and `Infinity`-free: a quality gain at no token cost reports as
 * `tokenDelta: 0` with `qualityPerKToken: null` rather than a divide-by-zero.
 *
 * @param {{quality: number, cost: Partial<ReturnType<typeof aggregateCost>>|null}} a
 * @param {{quality: number, cost: Partial<ReturnType<typeof aggregateCost>>|null}} b
 */
export function costEfficiency(a, b) {
  const qualityDelta = a.quality - b.quality;
  const at = a.cost?.meanTotalTokens;
  const bt = b.cost?.meanTotalTokens;
  if (typeof at !== "number" || typeof bt !== "number") {
    return { qualityDelta, tokenDelta: null, qualityPerKToken: null };
  }
  const tokenDelta = at - bt;
  return {
    qualityDelta,
    tokenDelta,
    qualityPerKToken: tokenDelta === 0 ? null : (qualityDelta / tokenDelta) * 1000
  };
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

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) await main();
