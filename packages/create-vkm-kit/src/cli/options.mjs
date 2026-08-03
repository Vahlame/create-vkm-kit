/**
 * What an install wants, decided once, from the flags.
 *
 * # Why this is its own module
 *
 * There used to be two installers. `runNonInteractive` derived ~25 toggles from argv; the
 * wizard derived a handful of them again, by hand, and simply had no notion of the rest.
 * Grepping the interactive path for `obscura|downloads|ollama|buildIndex|installBackend`
 * returned ZERO hits across 279 lines — so `npx create-vkm-kit --obscura` (without `-y`)
 * wired no obscura, `--downloads`/`--ollama`/`--build-index`/`--install-backend` did
 * nothing, and the DEFAULT path never installed the Python backend or built the index,
 * while `npx create-vkm-kit -y` installed the full stack. Two implementations of one
 * decision, drifted apart in features and in honesty.
 *
 * This function is that decision. It is PURE — no filesystem, no network, no prompts — so
 * it is testable directly and the wizard can take its result and override the four fields
 * it actually asks the user about. Anything that has to touch the world (does a kit clone
 * exist? did the obscura download succeed?) belongs to `install.mjs`, which degrades the
 * options it was given and reports what it dropped.
 *
 * @module
 */
import { flagValue } from "../mcp-merge.mjs";

/**
 * @typedef {object} InstallOptions
 * @property {"es"|"en"} lang
 * @property {boolean} dryRun
 * @property {boolean} full `--full`/`--all`: also flips the IDE default to codex,claude
 * @property {boolean} minimal `--minimal`: opt back down to plain basic-memory
 * @property {boolean} noCursorMcp
 * @property {boolean} noGitInit
 * @property {boolean} withHybrid
 * @property {boolean} semantic
 * @property {boolean} buildIndex
 * @property {boolean} installBackend
 * @property {boolean} vec
 * @property {boolean} rerank
 * @property {boolean} pinFailures
 * @property {boolean} usage
 * @property {boolean} gitleaks
 * @property {boolean} nativeOverride
 * @property {boolean} enforce
 * @property {boolean} effortGate
 * @property {boolean} tokenSaver
 * @property {boolean} terseStyle
 * @property {boolean} telemetry
 * @property {boolean} skills
 * @property {boolean} agents
 * @property {boolean} codexHooks
 * @property {boolean} codexContext
 * @property {boolean} codexMemoryGuard
 * @property {boolean} codexEffortGate
 * @property {boolean} codexTokenSaver
 * @property {boolean} ollama
 * @property {boolean} obscura
 * @property {boolean} downloads
 * @property {boolean} postgres
 * @property {string|null} pgDsn
 * @property {boolean} console
 * @property {string|null} searxngUrl
 * @property {string} researchDir
 * @property {string|null} downloadDir
 * @property {string|null} skillsDir
 * @property {string[]} ruleTargets
 * @property {import("../memory-rules.mjs").RulesProfile} rulesProfile
 */

/**
 * Resolve every install toggle from `argv`.
 *
 * The full stack is the DEFAULT (since 3.8.1): a bare install ships every feature, exactly
 * as `--full` did. `--minimal` opts back down to plain basic-memory; a granular `--no-<piece>`
 * drops one part; an explicit `--with-hybrid`/`--semantic`/… forces a piece on even under
 * `--minimal`. `--full`/`--all` remain aliases that also flip the IDE default, but no longer
 * gate the feature set.
 *
 * @param {string[]} argv
 * @param {object} ctx
 * @param {string} ctx.vault absolute vault path (needed for the RESEARCH/ default)
 * @param {string[]} ctx.ides the IDEs this run wires — several toggles are Claude Code-only
 * @param {"es"|"en"} ctx.lang
 * @param {boolean} ctx.dryRun
 * @param {(argv: string[], ides: string[], o: object) => string[]} ctx.rulesTargets
 * @param {(argv: string[], o: object) => any} ctx.rulesProfile
 * @returns {InstallOptions}
 */
export function resolveOptions(argv, ctx) {
  const { vault, ides, lang, dryRun, rulesTargets, rulesProfile } = ctx;
  const full = argv.includes("--full") || argv.includes("--all");
  const minimal = argv.includes("--minimal");

  /** Default-on unless `--minimal`; an explicit opt-in forces it, an opt-out always wins. */
  const on = (optIn, optOut) => (argv.includes(optIn) || !minimal) && !argv.includes(optOut);

  const claude = ides.includes("claude");
  const codex = ides.includes("codex");
  const codexHooks = codex && on("--codex-hooks", "--no-codex-hooks");
  const codexContext = codexHooks && on("--vault-context-hook", "--no-vault-context-hook");
  const codexMemoryGuard = codexHooks && on("--memory-enforcement", "--no-memory-enforcement");
  const codexEffortGate = codexHooks && on("--effort-gate", "--no-effort-gate");
  const codexTokenSaver = codexHooks && on("--token-saver", "--no-token-saver");
  const withHybrid = on("--with-hybrid", "--no-hybrid");

  // Claude Code only: disable the native per-project auto-memory + install the SessionStart
  // hook so the vault is the single source of truth (ADR-0029).
  const nativeOverride = claude && on("--native-memory-override", "--no-native-memory-override");
  // ADR-0030 enforcement hooks and the ADR-0031 effort gate ride along with that override,
  // each with its own opt-out.
  const enforce = nativeOverride && on("--memory-enforcement", "--no-memory-enforcement");
  const effortGate = nativeOverride && on("--effort-gate", "--no-effort-gate");
  // ADR-0043 token-saver + the vkm-terse output style. The style gets its own toggle —
  // changing Claude's voice is a preference, not pure noise removal — but ships ON.
  const tokenSaver = claude && on("--token-saver", "--no-token-saver");

  return {
    lang,
    dryRun,
    full,
    minimal,
    noCursorMcp: argv.includes("--no-cursor-mcp"),
    noGitInit: argv.includes("--no-git-init"),
    withHybrid,
    semantic: on("--semantic", "--no-semantic"),
    buildIndex: on("--build-index", "--no-build-index"),
    installBackend: on("--install-backend", "--no-install-backend"),
    // sqlite-vec acceleration (ADR-0025): ranking-identical with a safe fallback, so
    // shipping it by default costs nothing where the extension cannot load.
    vec: on("--vec", "--no-vec"),
    // Cross-encoder reranker (ADR-0026): a heavy, model-dependent precision pass. Strictly
    // opt-in — NOT part of the default stack — because it downloads a model on first use.
    rerank: withHybrid && argv.includes("--rerank"),
    // ADR-0038 retrieval levers over data already collected by default (recall_log), and
    // bench-gated in CI, so the default stack ships them ON.
    pinFailures: withHybrid && on("--pin-failures", "--no-pin-failures"),
    usage: withHybrid && on("--usage-boost", "--no-usage-boost"),
    gitleaks: argv.includes("--with-gitleaks"),
    nativeOverride,
    enforce,
    effortGate,
    tokenSaver,
    terseStyle: tokenSaver && on("--terse-style", "--no-terse-style"),
    // ADR-0044 local telemetry: OTEL env -> local sink so `vkm-doctor` can report real
    // usage. Independent of the token-saver: coupling them meant `--no-token-saver` on a
    // re-run silently stripped a sink the user never asked to touch.
    telemetry: claude && on("--telemetry", "--no-telemetry"),
    skills: (claude || codex) && on("--skills", "--no-skills"),
    agents: (claude || codex) && on("--agents", "--no-agents"),
    // Codex hooks are an independent `hooks.json` surface. Reuse the established
    // component flags without coupling skills, agent, or hooks to one another.
    codexHooks,
    codexContext,
    codexMemoryGuard,
    codexEffortGate,
    codexTokenSaver,
    // Ollama + phi4-mini (~2.3GB) and obscura (a ~40MB third-party binary) are gated to an
    // EXPLICIT opt-in: a bare install must not surprise anyone with a multi-GB download.
    ollama: (full || argv.includes("--ollama")) && !argv.includes("--no-ollama"),
    obscura: (full || argv.includes("--obscura")) && !argv.includes("--no-obscura"),
    // vkm-downloads (ADR-0058) has its OWN flag and is deliberately NOT folded into
    // `--full` even though `--full` includes obscura: this tool WRITES bytes to the user's
    // disk, a different risk surface from obscura's web reads, so opting into web access
    // must never silently grant disk-write capability.
    downloads: argv.includes("--downloads") && !argv.includes("--no-downloads"),
    // Postgres projection of the vault memory (vkm-memory-pg): part of the default stack —
    // PGlite is EMBEDDED (no server install, no surprise download), the vault stays the
    // source of truth and the projection is disposable. --no-postgres opts out; --postgres
    // forces it back on even under --minimal.
    postgres: on("--postgres", "--no-postgres"),
    // External Postgres DSN (VKM_PG_DSN): when set, the pg-service fronts that server
    // instead of the embedded PGlite datadir. Value flag, so it is null when absent.
    pgDsn: flagValue(argv, "--pg-dsn"),
    // vkm-console (Go TUI over the pg-service). Opt-in like obscura: building it shells
    // out to the Go toolchain, which a bare install must not require. --full turns it on;
    // --no-console always wins.
    console: (full || argv.includes("--console")) && !argv.includes("--no-console"),
    searxngUrl: flagValue(argv, "--searxng-url"),
    // RESEARCH/ persistence root defaults to <vault>/RESEARCH (ADR-0056).
    researchDir: flagValue(argv, "--obscura-research-dir") || `${vault}/RESEARCH`,
    downloadDir: flagValue(argv, "--download-dir"),
    // Compatibility escape hatch: install the skills into ANY client's skills folder
    // (Kimi Code, opencode, ...) — additive, independent of the --ide list.
    skillsDir: flagValue(argv, "--skills-dir"),
    // Rules ship by default too (part of "everything"); --no-rules / --minimal opt out.
    ruleTargets: rulesTargets(argv, ides, { full: !minimal }),
    rulesProfile: rulesProfile(argv, { minimal })
  };
}
