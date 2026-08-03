#!/usr/bin/env node
/**
 * @vkmikc/create-vkm-kit — interactive initializer.
 * Spanish-first CLI; pass --lang en for English labels.
 *
 * Source-of-truth lives in this `src/` directory. There is no `dist/` build
 * step — `src/` is what npm publishes and what `bin` in package.json points
 * to. (Pre-2026 the directory was named `dist/`, which falsely implied a
 * compile step. Renamed for clarity; see CHANGELOG.)
 */
import path from "node:path";
import pc from "picocolors";
import prompts from "prompts";
import fse from "fs-extra";
import { flagValue, resolveKitRepoRoot } from "./mcp-merge.mjs";
import { PROFILES, DEFAULT_PROFILE } from "./memory-rules.mjs";
import { uninstallClaudeNativeMemory } from "./claude-native-memory.mjs";
import { uninstallTokenSaver } from "./token-saver.mjs";
import { uninstallTelemetry } from "./telemetry.mjs";
import { uninstallPgHook } from "./pg-setup.mjs";
import { uninstallRunHidden } from "./runhidden-setup.mjs";
import { uninstallSkillAssets, skillAssetFiles } from "./skills-install.mjs";
import {
  codexAssetRoots,
  codexAssetsSidecar,
  codexHookAssetFiles,
  uninstallCodexNative
} from "./codex-native.mjs";
import { defaultVaultPath, findVault, scaffoldNewVault } from "./vault-scaffold.mjs";
import { ASSETS_SIDECAR_BASENAME } from "./asset-install.mjs";
import { buildUpdatePlan, applyUpdatePlan, summarizePlan, readKitVersion } from "./update-plan.mjs";
import { fetchLatestVersion, updateBanner } from "./version-check.mjs";
import { messages } from "./i18n.mjs";
import { printHelp } from "./cli/help.mjs";
import { resolveOptions } from "./cli/options.mjs";
import { printSummary, runInstall } from "./install.mjs";

function langFromArgs() {
  const i = process.argv.indexOf("--lang");
  if (i >= 0 && process.argv[i + 1] === "en") return "en";
  return "es";
}

function dryRunFromArgs() {
  return process.argv.includes("--dry-run");
}

/**
 * The directories `--check-update`/`--update` manage — exactly the documented scope
 * (the Claude and Codex skill/agent/hook locations the asset enumerators return). Passed
 * to `buildUpdatePlan` as `managedRoots` so the orphan sweep never reaches assets other
 * modules record in the same shared sidecar (the token-saver's output style, ADR-0043) —
 * without this bound, `--update` deleted `~/.claude/output-styles/vkm-terse.md` as an
 * "orphan" it never managed.
 * @param {string} home
 * @returns {{label: string, files: {src: string, dest: string}[], sidecarFp: string, managedRoots: string[]}[]}
 */
function updateScopes(home) {
  return [
    {
      label: "Claude Code assets",
      files: skillAssetFiles(home, { ide: "claude", skills: true, agents: true }),
      sidecarFp: path.join(home, ".claude", ASSETS_SIDECAR_BASENAME),
      managedRoots: [path.join(home, ".claude", "skills"), path.join(home, ".claude", "agents")]
    },
    {
      label: "Codex assets",
      files: [
        ...skillAssetFiles(home, { ide: "codex", skills: true, agents: true }),
        ...codexHookAssetFiles(home, { all: true })
      ],
      sidecarFp: codexAssetsSidecar(home),
      managedRoots: codexAssetRoots(home)
    }
  ];
}

/**
 * The `--full` (alias `--all`) one-shot preset: max power, zero questions. Turns
 * on hybrid + semantic + index build + backend install + rules, and defaults the
 * wired IDEs to Codex + Claude Code. Implies non-interactive.
 */
function fullPresetFromArgs() {
  return process.argv.includes("--full") || process.argv.includes("--all");
}

function nonInteractiveFromArgs() {
  return (
    process.argv.includes("--non-interactive") ||
    process.argv.includes("--yes") ||
    process.argv.includes("-y") ||
    fullPresetFromArgs()
  );
}

// Long flags that consume the NEXT token as their value, so it isn't mistaken
// for the positional vault path.
const VALUE_FLAGS = new Set([
  "--vault",
  "--ide",
  "--repo-root",
  "--lang",
  "--rules",
  "--rules-profile",
  "--pg-dsn"
]);

/**
 * First bare (non-flag) CLI argument = vault path shorthand, so you can write
 * `create-vkm-kit ./my-vault` instead of `--vault ./my-vault`.
 * @param {string[]} argv
 */
function positionalVault(argv) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("-")) {
      if (VALUE_FLAGS.has(a)) i++; // skip this flag's value
      continue;
    }
    return a;
  }
  return null;
}
function rulesTargetsFromArgs(argv, ides, { defaultFromIde = false, full = false } = {}) {
  if (argv.includes("--no-rules")) return [];
  const raw = flagValue(argv, "--rules");
  const valid = ["claude", "agents", "cursor", "codex"];
  if (raw) {
    const v = raw.trim().toLowerCase();
    if (v === "none") return [];
    if (v === "all") return [...valid];
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => valid.includes(s));
  }
  // `--full` is "everything on": install the project AGENTS.md rules plus the
  // global rules file for each wired agent, so recall works out of the box.
  if (full) return rulesFromIdes(ides);
  // Headless with no --rules → write nothing (don't surprise-touch global files).
  // Interactive derives a default from the selected IDEs, then asks for confirmation.
  if (!defaultFromIde) return [];
  return rulesFromIdes(ides);
}

/**
 * Which rule LEVELS to inject (ADR-0067): `--rules-profile minimal|standard|full`.
 *
 * Default `full` — the kit's advertised default is the full stack, and quietly
 * shipping less doctrine than the docs describe would be its own kind of drift.
 * `--minimal` (basic-memory only) implies `standard`: `core` alone never teaches
 * recall or the close ritual, so a minimal install with minimal rules would wire
 * memory tools the model is never told to use.
 *
 * An unrecognized value falls back to the default rather than throwing — a typo in
 * an install flag should not abort an install half-way through.
 * @param {string[]} argv
 * @param {{ minimal?: boolean }} [opts]
 * @returns {import("./memory-rules.mjs").RulesProfile}
 */
function rulesProfileFromArgs(argv, { minimal = false } = {}) {
  const raw = flagValue(argv, "--rules-profile");
  const v = raw?.trim().toLowerCase();
  if (v && Object.prototype.hasOwnProperty.call(PROFILES, v)) {
    return /** @type {import("./memory-rules.mjs").RulesProfile} */ (v);
  }
  if (v) console.warn(pc.yellow(`Unknown --rules-profile "${raw}"; using the default.`));
  return minimal ? "standard" : DEFAULT_PROFILE;
}

/** Project AGENTS.md + the global rules file for each wired agent. */
function rulesFromIdes(ides) {
  const targets = ["agents"];
  if (ides.includes("claude")) targets.push("claude");
  if (ides.includes("codex")) targets.push("codex");
  if (ides.includes("cursor")) targets.push("cursor");
  return targets;
}
/**
 * Parse `--ide codex,claude` → lowercased array. When `--ide` is omitted the
 * default is `["cursor"]` for back-compat, except under `--full`, whose focus is
 * Codex + Claude Code (`["codex", "claude"]`).
 * @param {string[]} argv
 * @param {{ full?: boolean }} [opts]
 */
function idesFromArgs(argv, { full = false } = {}) {
  const raw = flagValue(argv, "--ide");
  if (!raw) return full ? ["codex", "claude"] : ["cursor"];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
/**
 * The shared preamble of both flows: everything that must be decided before an install
 * can start, once the vault and the IDE list are known.
 * @param {string[]} argv
 * @param {{ vault: string, ides: string[], lang: "es"|"en", dryRun: boolean,
 *   defaultFromIde?: boolean }} ctx
 */
function optionsFor(argv, { vault, ides, lang, dryRun, defaultFromIde = false }) {
  return resolveOptions(argv, {
    vault,
    ides,
    lang,
    dryRun,
    // The wizard derives its default rule targets from the IDEs the user just picked;
    // the headless path derives them from the feature level. Same function, different
    // question, so the caller supplies which one it is asking.
    rulesTargets: (a, i, o) =>
      rulesTargetsFromArgs(a, i, defaultFromIde ? { defaultFromIde: true } : o),
    rulesProfile: rulesProfileFromArgs
  });
}

/**
 * Headless / CI path: no prompts.
 * @param {string[]} argv
 */
async function runHeadless(argv) {
  const cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || cwd;
  const lang = langFromArgs();
  const dryRun = dryRunFromArgs();
  // Vault path: --vault wins, else the first positional arg, else the default
  // (~/Documents/obsidian-memory-vault). No flag required for the common case.
  const vaultRaw = flagValue(argv, "--vault") || positionalVault(argv);
  const usedDefault = !vaultRaw;
  const vault = path.resolve(cwd, vaultRaw || defaultVaultPath(home));
  // Create a starter vault if the path isn't one yet, instead of erroring — a one-shot
  // install shouldn't require pre-creating the folder by hand. scaffoldNewVault owns the
  // dry-run check; this only records what happened.
  let createdVault = false;
  if (!(await fse.pathExists(path.join(vault, ".obsidian")))) {
    await scaffoldNewVault(vault, lang, dryRun);
    createdVault = !dryRun;
  }

  const ides = idesFromArgs(argv, { full: fullPresetFromArgs() });
  const opts = optionsFor(argv, { vault, ides, lang, dryRun });

  console.log(
    pc.cyan(messages[lang].title),
    pc.dim(opts.full ? "full preset" : opts.minimal ? "minimal" : "full stack (default)")
  );

  const result = await runInstall({ argv, home, cwd, vault, ides, opts });
  printSummary({ vault, ides, opts, result, meta: { usedDefault, createdVault } });
}

/**
 * Interactive path: ask for the handful of things a person decides, then run the SAME
 * install as `--yes`.
 *
 * The wizard used to be a second implementation, and the features it did not know about
 * — obscura, downloads, Ollama, the Python backend, the index build — were simply
 * unreachable from the DEFAULT invocation. Its only job now is to fill in answers on top
 * of the options the flags already produced.
 *
 * @param {string[]} argv
 */
async function runWizard(argv) {
  const lang = langFromArgs();
  const dryRun = dryRunFromArgs();
  const t = messages[lang];
  // The real installed version, not a hardcoded string: this banner still read "v2 / v3"
  // on a 4.x kit, so the one place every user sees a version was the one place guaranteed
  // to be wrong.
  console.log(pc.cyan(t.title), pc.dim(`v${readKitVersion()}`));
  if (dryRun) console.log(pc.dim("dry-run: nothing will be written"));

  const cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || cwd;
  const posVault = positionalVault(argv);
  let vault = posVault ? path.resolve(cwd, posVault) : await findVault(cwd, home);
  let createdVault = false;

  // A positional path that isn't a vault yet → scaffold it, no prompt needed.
  if (vault && !(await fse.pathExists(path.join(vault, ".obsidian")))) {
    await scaffoldNewVault(vault, lang, dryRun);
    createdVault = !dryRun;
  }

  if (!vault) {
    const { ok } = await prompts({
      type: "confirm",
      name: "ok",
      message: t.createVault,
      initial: true
    });
    if (ok) {
      vault = defaultVaultPath(home);
      await scaffoldNewVault(vault, lang, dryRun);
      createdVault = !dryRun;
    } else {
      const { p } = await prompts({
        type: "text",
        name: "p",
        message: t.vaultQ,
        initial: defaultVaultPath(home)
      });
      vault = p;
    }
  }
  if (!vault) {
    console.error(pc.red("No vault path; aborted."));
    process.exit(1);
  }
  vault = path.resolve(cwd, vault);

  const { ides = [] } = await prompts({
    type: "multiselect",
    name: "ides",
    message: t.ides,
    choices: [
      { title: "Codex CLI", value: "codex", selected: true },
      { title: "Claude Code", value: "claude", selected: true },
      { title: "Cursor", value: "cursor", selected: false },
      { title: "VS Code / Cline", value: "cline", selected: false },
      { title: "Windsurf", value: "windsurf", selected: false },
      { title: "Zed", value: "zed", selected: false }
    ]
  });

  const opts = optionsFor(argv, { vault, ides, lang, dryRun, defaultFromIde: true });

  const { gitleaks } = await prompts({
    type: "confirm",
    name: "gitleaks",
    message: t.gitleaks,
    initial: true
  });
  opts.gitleaks = Boolean(gitleaks);

  // Only ask about hybrid when there is a clone to run it from — otherwise the question
  // is moot and runInstall would degrade the answer away with a warning anyway.
  if (opts.withHybrid) {
    const kitRoot = await resolveKitRepoRoot({ cwd, argv, pathExists: (p) => fse.pathExists(p) });
    if (!kitRoot) {
      opts.withHybrid = false;
    } else {
      const { hybrid } = await prompts({
        type: "confirm",
        name: "hybrid",
        message: t.hybridQ,
        initial: true
      });
      opts.withHybrid = Boolean(hybrid);
      if (opts.withHybrid) {
        const { semantic } = await prompts({
          type: "confirm",
          name: "semantic",
          message: t.semanticQ,
          initial: true
        });
        opts.semantic = Boolean(semantic);
      }
    }
    if (!opts.withHybrid) {
      // Keep the derived toggles consistent with the answer, the same way
      // resolveOptions would have derived them from a `--no-hybrid` flag.
      Object.assign(opts, { semantic: false, rerank: false, pinFailures: false, usage: false });
    }
  }

  // Postgres projection + console: asked like hybrid/semantic — the wizard only overrides
  // what it actually asks, on top of what the flags already resolved. The initial answer
  // IS the resolved flag value (projection on by default, console off), so an explicit
  // --no-postgres/--console shows up as the prompt's default instead of being contradicted
  // by a hardcoded true/false.
  const { pg } = await prompts({
    type: "confirm",
    name: "pg",
    message: t.pgQ,
    initial: opts.postgres
  });
  opts.postgres = Boolean(pg);
  const { consoleTui } = await prompts({
    type: "confirm",
    name: "consoleTui",
    message: t.consoleQ,
    initial: opts.console
  });
  opts.console = Boolean(consoleTui);

  if (opts.ruleTargets.length) {
    const { rules } = await prompts({
      type: "confirm",
      name: "rules",
      message: t.rulesQ,
      initial: true
    });
    if (!rules) opts.ruleTargets = [];
  }

  const result = await runInstall({ argv, home, cwd, vault, ides, opts });
  printSummary({ vault, ides, opts, result, meta: { createdVault } });
}

async function main() {
  const argv = process.argv;
  // Before --help and before anything interactive: `--version` used to fall through
  // to the wizard, so the standard way to answer "which version are you on?" started
  // an install instead of printing a version — including in the bug-report template.
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(readKitVersion());
    return;
  }
  if (argv.includes("--help")) {
    printHelp();
    return;
  }

  // Before --check-update: this is a read-only diagnostic and must stay reachable even when an
  // install is half-finished — a machine that flashes consoles is usually one whose wiring is off.
  if (argv.includes("--windows-audit")) {
    const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
    const watchArg = flagValue(argv, "--watch");
    const { runWindowsAudit } = await import("./windows-audit.mjs");
    process.exitCode = await runWindowsAudit({
      home,
      fix: argv.includes("--fix"),
      watchSeconds: watchArg ? Number(watchArg) : null,
      dryRun: dryRunFromArgs()
    });
    return;
  }

  if (argv.includes("--check-update")) {
    const cwd = process.cwd();
    const home = process.env.HOME || process.env.USERPROFILE || cwd;
    const current = readKitVersion();
    const latest = await fetchLatestVersion();
    console.log(pc.cyan("Installed version:"), current);
    if (latest === null) {
      console.log(pc.dim("Could not reach the npm registry (offline?) — skipped."));
    } else {
      console.log(pc.cyan("Latest on npm:"), latest);
      const banner = updateBanner({ current, latest });
      if (banner) console.log(banner);
    }
    for (const scope of updateScopes(home)) {
      const plan = await buildUpdatePlan({ home, ...scope });
      console.log(pc.cyan(`${scope.label}:`));
      console.log(summarizePlan(plan));
    }
    return;
  }

  if (argv.includes("--update")) {
    const cwd = process.cwd();
    const home = process.env.HOME || process.env.USERPROFILE || cwd;
    const dryRun = dryRunFromArgs();
    const force = argv.includes("--force");
    if (dryRun) console.log(pc.dim("[dry-run] no files will be written"));
    const results = [];
    for (const scope of updateScopes(home)) {
      const plan = await buildUpdatePlan({ home, ...scope });
      console.log(pc.cyan(`${scope.label}:`));
      console.log(summarizePlan(plan));
      results.push(await applyUpdatePlan({ plan, sidecarFp: scope.sidecarFp, force, dryRun }));
    }
    const applied = results.flatMap((result) => result.applied);
    const skipped = results.flatMap((result) => result.skipped);
    const removed = results.flatMap((result) => result.removed);
    console.log(
      pc.green(`Applied: ${applied.length}`),
      pc.dim(`Skipped: ${skipped.length}`),
      pc.dim(`Removed: ${removed.length}`)
    );
    // Both "conflict" (you edited it AND the kit changed it) and "local-only" (you edited it,
    // the kit did not) are, from the user's side, the same fact: a managed file carrying your
    // edits that this run deliberately left alone. Report them together — counting only
    // conflicts would stay silent about the far more common local-only case.
    const yours = skipped.filter((e) => e.state === "conflict" || e.state === "local-only");
    if (yours.length) {
      console.log(
        pc.yellow(
          `${yours.length} file(s) left untouched because you edited them locally. Re-run with --force to reset them to the versions this kit ships — this DISCARDS your local edits to those files.`
        )
      );
      for (const entry of yours) console.log(pc.dim(`  ${entry.dest}`));
    }
    return;
  }

  if (argv.includes("--uninstall")) {
    const cwd = process.cwd();
    const home = process.env.HOME || process.env.USERPROFILE || cwd;
    const dryRun = dryRunFromArgs();
    await uninstallClaudeNativeMemory(home, dryRun);
    await uninstallTokenSaver(home, dryRun);
    await uninstallTelemetry(home, dryRun);
    await uninstallPgHook(home, dryRun);
    await uninstallSkillAssets(home, dryRun, { ide: "claude" });
    await uninstallCodexNative(home, dryRun);
    await uninstallSkillAssets(home, dryRun, { ide: "codex" });
    await uninstallRunHidden(home, dryRun);
    return;
  }

  if (nonInteractiveFromArgs()) {
    await runHeadless(argv);
    return;
  }
  await runWizard(argv);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
