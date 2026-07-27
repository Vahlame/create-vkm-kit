#!/usr/bin/env node
/**
 * Arm builder for behavioural A/B benches: install the kit into a throwaway HOME with
 * a named subset of the fixed layer present, and **prove** that subset is what landed.
 *
 * WP1 (the off-target control ADR-0063 deferred) needs to answer "what does the fixed
 * context layer cost in behaviour, on tasks it has nothing to do with?". That question
 * is only answerable if the arms differ in exactly the layer under test and in nothing
 * else — which is the part that is easy to get wrong, and was already wrong here:
 *
 *   Both existing temp-HOME installers (`scripts/e2e-smoke.mjs:60`,
 *   `scripts/harness-matrix.mjs:127`) install with `--minimal --no-skills --no-agents`,
 *   because neither is measuring behaviour — one proves stdio search works, the other
 *   proves wiring lands. Reusing either as a "kit installed" arm builds a subject that
 *   is **missing the layer under test** and reports the resulting null as evidence.
 *
 * So this module's contract is not "install the kit". It is: **an arm declares which
 * layers it carries, and a build that does not match its declaration throws.** A
 * mislabelled arm is worse than a failed build — a failed build stops the bench, a
 * mislabelled one publishes a number.
 *
 * The probe reads the real filesystem (`~/.claude/`, `~/.claude.json`, `./AGENTS.md`),
 * never the installer's own exit code or stdout. What the installer *says* it did and
 * what a subject session will actually load are different claims, and only the second
 * one is the independent variable.
 *
 * Usage:
 *   import { buildArm, ARMS } from "./arm-install.mjs";
 *   const arm = buildArm("full", { repoRoot: REPO });
 *   await runSubject({ prompt, home: arm.home, cwd: arm.cwd });
 *   arm.cleanup();
 *
 * CLI (prints the probed layers of every arm — the evidence for an ADR or a README):
 *   node evals/lib/arm-install.mjs --json
 *   VKM_ARM_KEEP=1 node evals/lib/arm-install.mjs --arm full
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { levelBody } from "../../packages/create-vkm-kit/src/memory-rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.join(HERE, "..", "..");
const TIMEOUT_MS = 300_000;

/**
 * Flags that strip every optional Claude Code surface. An arm opts pieces back **in**
 * rather than out: a spec that forgets a flag then under-installs, which the probe
 * catches, whereas a spec that forgets a `--no-` flag would over-install silently into
 * whatever the installer's defaults grow into next release.
 */
const STRIP = [
  "--no-skills",
  "--no-agents",
  "--no-token-saver",
  "--no-memory-enforcement",
  "--no-effort-gate",
  "--no-native-memory-override",
  "--no-telemetry"
];

/** Everything that costs a network round-trip or a Python env; never part of a bench arm. */
const OFFLINE = [
  "--no-git",
  "--no-install-backend",
  "--no-build-index",
  "--no-semantic",
  "--no-vec"
];

/**
 * What an arm asserts about itself. Every layer is optional (an arm checks what it is
 * about), and every list-valued layer also accepts `true`, meaning "non-empty" — the
 * distinction that lets `full` assert hooks and MCP are loaded without pinning lists
 * that legitimately change every release.
 *
 * @typedef {object} ArmExpect
 * @property {string[]|true} [rules]
 * @property {string[]|true} [skills]
 * @property {string[]|true} [hooks]
 * @property {string[]|true} [mcp]
 * @property {boolean} [subagent]
 * @property {string|null} [outputStyle]
 * @property {number} [rulesChars]
 */

/**
 * @typedef {object} ArmSpec
 * @property {string} label            human name for a results table
 * @property {string[]|null} args      installer flags, or null for "run no installer at all"
 * @property {ArmExpect} expect        asserted after the build; only declared keys are checked
 * @property {string} [requiresCli]    arm is unbuildable without this CLI on PATH
 */

/**
 * The dose-response ladder plus its control. `off` is the one that makes the rest
 * interpretable: without a subject that never met the kit, every delta is measured
 * against another dose of the same thing.
 * @type {Record<string, ArmSpec>}
 */
export const ARMS = {
  off: {
    label: "no kit (control)",
    args: null,
    expect: { rules: [], skills: [], subagent: false, hooks: [], outputStyle: null, mcp: [] }
  },
  core: {
    label: "rules: core only",
    args: ["--ide", "none", "--rules", "agents,claude", "--rules-profile", "minimal", ...STRIP],
    expect: { rules: ["core"], skills: [], subagent: false, hooks: [], outputStyle: null }
  },
  standard: {
    label: "rules: core+memory",
    args: ["--ide", "none", "--rules", "agents,claude", "--rules-profile", "standard", ...STRIP],
    expect: { rules: ["core", "memory"], skills: [], subagent: false, hooks: [], outputStyle: null }
  },
  "rules-full": {
    label: "rules: all three levels",
    args: ["--ide", "none", "--rules", "agents,claude", "--rules-profile", "full", ...STRIP],
    expect: {
      rules: ["core", "memory", "doctrine"],
      skills: [],
      subagent: false,
      hooks: [],
      outputStyle: null
    }
  },
  full: {
    label: "default install (everything)",
    args: ["--ide", "claude", "--rules", "agents,claude", "--rules-profile", "full"],
    // `claude mcp add -s user` is how this arm gets its MCP layer, so without the CLI
    // the arm cannot be built at all. Reported as `skipped`, never as a pass with an
    // empty mcp list — the same rule harness-matrix applies to absent CLIs.
    requiresCli: "claude",
    // Hooks and MCP are asserted as non-empty rather than pinned to a list: their
    // membership is the installer's business and changes per release, while "the
    // subject session loads deterministic enforcement at all" is what the arm means.
    expect: {
      rules: ["core", "memory", "doctrine"],
      skills: true,
      subagent: true,
      hooks: true,
      outputStyle: "vkm-terse",
      mcp: true
    }
  }
};

/**
 * @typedef {object} ProbedLayers
 * @property {string[]} rules        rule levels found verbatim inside the managed block
 * @property {string[]} skills       installed skill directory names
 * @property {boolean} subagent      ~/.claude/agents/ carries the kit subagent
 * @property {string[]} hooks        hook script basenames actually registered in settings.json
 * @property {string|null} outputStyle
 * @property {string[]} mcp          MCP servers registered for this HOME
 * @property {number} rulesChars     size of the managed block; 0 when absent
 */

const readOr = (fp, fallback = null) => {
  try {
    return fs.readFileSync(fp, "utf8");
  } catch {
    return fallback;
  }
};
const jsonOr = (fp, fallback) => {
  const t = readOr(fp);
  if (t === null) return fallback;
  try {
    return JSON.parse(t);
  } catch {
    return fallback;
  }
};

/**
 * What a subject session started in (`home`, `cwd`) would actually load.
 *
 * Rule levels are detected by verbatim containment of each level's own body (the first
 * heading of `levelBody`), not by a hand-copied marker string: the check then cannot
 * drift away from what `memory-rules.mjs` ships, which is the only way a level could
 * be renamed and every arm keep reporting the old composition.
 *
 * @param {string} home @param {string} cwd @param {"es"|"en"} [lang]
 * @returns {ProbedLayers}
 */
export function probeArm(home, cwd, lang = "es") {
  const claudeDir = path.join(home, ".claude");
  const block =
    readOr(path.join(claudeDir, "CLAUDE.md")) ?? readOr(path.join(cwd, "AGENTS.md")) ?? "";
  const rules = /** @type {const} */ (["core", "memory", "doctrine"]).filter((lvl) => {
    const head = levelBody(lvl, lang).split("\n")[0].trim();
    return head.length > 0 && block.includes(head);
  });
  const settings = jsonOr(path.join(claudeDir, "settings.json"), {});
  // The kit registers hooks as {command: "node", args: [script, …]} — reading `command`
  // alone yields "node" for every hook and an empty list after filtering, which is how
  // this probe first reported `hooks=0` for an install carrying seven of them.
  const hooks = [
    ...new Set(
      Object.values(settings.hooks ?? {})
        .flat()
        .flatMap((m) => m?.hooks ?? [])
        .map((h) =>
          [String(h?.command ?? ""), ...(Array.isArray(h?.args) ? h.args.map(String) : [])]
            .flatMap((tok) => tok.replace(/["']/g, "").trim().split(/\s+/))
            .map((tok) => path.basename(tok))
            .find((b) => b.endsWith(".mjs") || b.endsWith(".js"))
        )
        .filter(Boolean)
    )
  ].sort();
  const lsDirs = (d) => {
    try {
      return fs
        .readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  };
  return {
    rules,
    rulesChars: block.includes("vkm-kit:start") ? block.length : 0,
    skills: lsDirs(path.join(claudeDir, "skills")),
    subagent: fs.existsSync(path.join(claudeDir, "agents", "vkm-implementer.md")),
    hooks,
    outputStyle: settings.outputStyle ?? null,
    mcp: Object.keys(jsonOr(path.join(home, ".claude.json"), {}).mcpServers ?? {}).sort()
  };
}

/** Thrown when a build produced an arm that is not the arm that was asked for. */
export class ArmMismatchError extends Error {
  /** @param {string} name @param {{layer: string, want: unknown, got: unknown}[]} diffs */
  constructor(name, diffs) {
    super(
      `arm "${name}" did not install what it declares:\n` +
        diffs
          .map((d) => `  ${d.layer}: want ${JSON.stringify(d.want)}, got ${JSON.stringify(d.got)}`)
          .join("\n")
    );
    this.name = "ArmMismatchError";
    this.diffs = diffs;
  }
}

/**
 * Compare only the keys an arm declares. An array expectation is an exact set; `true`
 * on an array-valued layer means "non-empty" — the distinction that lets `full` assert
 * "hooks are loaded" without pinning a list that legitimately changes every release.
 * @param {ArmExpect} expect @param {ProbedLayers} got
 */
export function diffLayers(expect, got) {
  /** @type {{layer: string, want: unknown, got: unknown}[]} */
  const diffs = [];
  for (const [layer, want] of Object.entries(expect)) {
    const actual = got[/** @type {keyof ProbedLayers} */ (layer)];
    const ok =
      Array.isArray(want) && Array.isArray(actual)
        ? want.length === actual.length && want.every((v) => actual.includes(v))
        : want === true && Array.isArray(actual)
          ? actual.length > 0
          : want === actual;
    if (!ok) diffs.push({ layer, want, got: actual });
  }
  return diffs;
}

/**
 * Install one arm and verify it. Throws `ArmMismatchError` rather than returning a
 * subject whose independent variable is unknown.
 *
 * @param {string|ArmSpec} nameOrSpec
 * @param {{repoRoot?: string, lang?: "es"|"en", keep?: boolean}} [opts]
 */
export function buildArm(nameOrSpec, opts = {}) {
  const name = typeof nameOrSpec === "string" ? nameOrSpec : (nameOrSpec.label ?? "custom");
  const spec = typeof nameOrSpec === "string" ? ARMS[nameOrSpec] : nameOrSpec;
  if (!spec) throw new Error(`unknown arm "${name}" (have: ${Object.keys(ARMS).join(", ")})`);
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO;
  const lang = opts.lang ?? "es";
  const keep = opts.keep ?? process.env.VKM_ARM_KEEP === "1";

  const mk = (kind) => fs.mkdtempSync(path.join(os.tmpdir(), `vkm-arm-${kind}-`));
  const home = mk("home");
  const cwd = mk("cwd");
  const vault = mk("vault");
  let installError;
  if (spec.args) {
    try {
      execFileSync(
        process.execPath,
        [
          path.join(repoRoot, "packages", "create-vkm-kit", "src", "index.js"),
          "--non-interactive",
          "-y",
          "--vault",
          vault,
          "--repo-root",
          repoRoot,
          "--lang",
          lang,
          ...OFFLINE,
          ...spec.args
        ],
        { env: { ...process.env, HOME: home }, cwd, stdio: "pipe", timeout: TIMEOUT_MS }
      );
    } catch (e) {
      installError = String(e?.stderr ?? e?.message ?? e).slice(0, 400);
    }
  }
  const layers = probeArm(home, cwd, lang);
  const cleanup = () => {
    if (keep) return;
    for (const d of [home, cwd, vault]) fs.rmSync(d, { recursive: true, force: true });
  };
  const diffs = diffLayers(spec.expect ?? {}, layers);
  if (diffs.length) {
    cleanup();
    throw new ArmMismatchError(
      name,
      installError ? [...diffs, { layer: "install", want: "ok", got: installError }] : diffs
    );
  }
  return { name, label: spec.label ?? name, home, cwd, vault, layers, cleanup };
}

/** Is a CLI on PATH? @param {string} cmd */
export function cliPresent(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * @typedef {object} SurveyRow
 * @property {string} name
 * @property {string} label
 * @property {boolean} ok
 * @property {boolean} [skipped]  required CLI absent: unmeasured, not failed
 * @property {string} [error]
 * @property {string} [home]      only when the arm was kept for inspection
 * @property {ProbedLayers} [layers]
 */

/**
 * Build every arm, probe it, tear it down. The evidence table for an ADR.
 * An arm whose required CLI is absent comes back `skipped: true` — it is neither
 * green nor a failure, and a bench that finds a skipped arm in its results must
 * refuse to report that comparison rather than treat the missing layer as "off".
 * @param {{repoRoot?: string, lang?: "es"|"en", keep?: boolean}} [opts]
 * @returns {SurveyRow[]}
 */
export function surveyArms(opts = {}) {
  return Object.keys(ARMS).map((name) => {
    const spec = ARMS[name];
    if (spec.requiresCli && !cliPresent(spec.requiresCli)) {
      return {
        name,
        label: spec.label,
        ok: false,
        skipped: true,
        error: `no \`${spec.requiresCli}\` CLI here`
      };
    }
    try {
      const arm = buildArm(name, opts);
      const { layers, label } = arm;
      arm.cleanup();
      return { name, label, ok: true, layers };
    } catch (e) {
      return { name, label: spec.label, ok: false, error: String(e.message).slice(0, 600) };
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  const one = args.includes("--arm") ? args[args.indexOf("--arm") + 1] : null;
  /** @type {SurveyRow[]} */
  const rows = one
    ? [
        (() => {
          const a = buildArm(one);
          return { name: a.name, label: a.label, ok: true, home: a.home, layers: a.layers };
        })()
      ]
    : surveyArms();
  if (args.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const r of rows) {
      if (!r.ok) {
        console.log(`${r.skipped ? "⚪" : "✗"} ${r.name.padEnd(11)} ${r.error}`);
        continue;
      }
      const l = /** @type {ProbedLayers} */ (r.layers);
      console.log(
        `✓ ${r.name.padEnd(11)} rules=[${l.rules.join(",") || "-"}] ${String(l.rulesChars).padStart(5)}c ` +
          `skills=${l.skills.length} subagent=${l.subagent ? "y" : "n"} hooks=${l.hooks.length} ` +
          `style=${l.outputStyle ?? "-"} mcp=[${l.mcp.join(",") || "-"}]`
      );
      if (r.home) console.log(`  kept at ${r.home}`);
    }
  }
  if (rows.some((r) => !r.ok && !r.skipped)) process.exitCode = 1;
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) main();
