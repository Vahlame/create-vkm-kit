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
import { execa } from "execa";
import fse from "fs-extra";
import {
  basicMemoryServer,
  flagValue,
  hybridMcpPathsFromKitRoot,
  resolveKitRepoRoot,
  SEMANTIC_EMBEDDER
} from "./mcp-merge.mjs";
import { registerClaudeCodeMcp, registerCodexMcp, writeCursorMcp } from "./mcp-register.mjs";
import { installRules } from "./rules-merge.mjs";
import { PROFILES, DEFAULT_PROFILE } from "./memory-rules.mjs";
import {
  configureClaudeNativeMemory,
  uninstallClaudeNativeMemory
} from "./claude-native-memory.mjs";
import { configureTokenSaver, uninstallTokenSaver } from "./token-saver.mjs";
import { configureTelemetry, uninstallTelemetry } from "./telemetry.mjs";
import { installRunHidden, uninstallRunHidden } from "./runhidden-setup.mjs";
import { configureSkillAssets, uninstallSkillAssets, skillAssetFiles } from "./skills-install.mjs";
import { maybeInstallOllama } from "./ollama-setup.mjs";
import { maybeInstallObscura } from "./obscura-setup.mjs";
import {
  defaultVaultPath,
  findVault,
  scaffoldNewVault,
  writeVaultGitWorkspaceSettings
} from "./vault-scaffold.mjs";
import { ASSETS_SIDECAR_BASENAME } from "./asset-install.mjs";
import { buildUpdatePlan, applyUpdatePlan, summarizePlan, readKitVersion } from "./update-plan.mjs";
import { fetchLatestVersion, updateBanner } from "./version-check.mjs";
import { messages } from "./i18n.mjs";
import { printHelp } from "./cli/help.mjs";

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
 * (`~/.claude/skills/` + `~/.claude/agents/`, the set `skillAssetFiles` enumerates). Passed
 * to `buildUpdatePlan` as `managedRoots` so the orphan sweep never reaches assets other
 * modules record in the same shared sidecar (the token-saver's output style, ADR-0043) —
 * without this bound, `--update` deleted `~/.claude/output-styles/vkm-terse.md` as an
 * "orphan" it never managed.
 * @param {string} home
 * @returns {string[]}
 */
function updateRoots(home) {
  return [path.join(home, ".claude", "skills"), path.join(home, ".claude", "agents")];
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
  "--rules-profile"
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
async function maybeInstallGitleaksHook(vault, enable, dryRun) {
  if (!enable) return;
  const gitDir = path.join(vault, ".git");
  if (!(await fse.pathExists(gitDir))) {
    console.warn(pc.yellow("gitleaks hook: vault has no .git; skipping (re-run after git init)"));
    return;
  }
  const hookPath = path.join(gitDir, "hooks", "pre-commit");
  const script = `#!/usr/bin/env sh
# obsidian-memory vault: gitleaks pre-commit guard
# Refuses commits that introduce secrets. Install gitleaks per OS:
#   macOS:   brew install gitleaks
#   Windows: winget install gitleaks
#   Linux:   see https://github.com/gitleaks/gitleaks#installing
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks not installed; pre-commit guard skipped." >&2
  echo "  install: https://github.com/gitleaks/gitleaks" >&2
  exit 0
fi
exec gitleaks protect --staged --no-banner --redact
`;
  if (dryRun) {
    console.log(pc.cyan("[dry-run] would install"), hookPath);
    return;
  }
  await fse.ensureDir(path.dirname(hookPath));
  await fse.writeFile(hookPath, script, "utf8");
  if (process.platform !== "win32") {
    try {
      await fse.chmod(hookPath, 0o755);
    } catch {
      /* ignore */
    }
  }
  console.log(pc.green("Installed gitleaks pre-commit hook at"), hookPath);
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
async function maybeInstallBackend(repoRoot, semantic, dryRun, vec = false, rerank = false) {
  if (!repoRoot) return;
  const ragPkg = path.join(repoRoot, "packages", "obsidian-memory-rag");
  const extras = [
    semantic ? "semantic" : null,
    vec ? "vec" : null,
    rerank ? "rerank" : null
  ].filter(Boolean);
  const spec = ragPkg + (extras.length ? `[${extras.join(",")}]` : "");
  const py = process.platform === "win32" ? "python" : "python3";
  const args = ["-m", "pip", "install", "-e", spec];
  if (dryRun) {
    console.log(pc.cyan("[dry-run] would install backend:"), py, args.join(" "));
    return;
  }
  try {
    const r = await execa(py, args, { reject: false });
    if (r.exitCode === 0) {
      console.log(
        pc.green("Python backend installed"),
        extras.length ? `(with [${extras.join(",")}])` : ""
      );
    } else {
      console.warn(pc.yellow("Backend install skipped/failed — run it manually:"));
      console.log('  pip install -e "' + spec + '"');
    }
  } catch {
    console.warn(pc.yellow("python not found; install the backend later:"));
    console.log('  pip install -e "' + spec + '"');
  }
}

/**
 * Optionally build the local FTS (+semantic) index so search works on first use.
 * Best-effort: prints the pip command if the Python backend isn't importable.
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {{ repoRoot?: string|null, semantic?: boolean }} [opts]
 */
async function maybeBuildIndex(vaultAbs, dryRun, { repoRoot = null, semantic = false } = {}) {
  if (!repoRoot) return;
  const pySrc = path.join(repoRoot, "packages", "obsidian-memory-rag", "src");
  const args = ["-m", "obsidian_memory_rag", "index", "--vault", vaultAbs];
  if (semantic) args.push("--semantic", "--embedder", SEMANTIC_EMBEDDER);
  const py = process.platform === "win32" ? "python" : "python3";
  if (dryRun) {
    console.log(pc.cyan("[dry-run] would build index:"), py, args.join(" "));
    return;
  }
  try {
    const r = await execa(py, args, {
      env: { ...process.env, PYTHONPATH: pySrc, PYTHONUTF8: "1" },
      reject: false
    });
    if (r.exitCode === 0) console.log(pc.green("Index built"), semantic ? "(semantic)" : "(FTS)");
    else {
      const ragPkg = path.join(repoRoot, "packages", "obsidian-memory-rag");
      console.warn(pc.yellow("Index build skipped/failed — install the backend first:"));
      console.log('  pip install -e "' + ragPkg + (semantic ? '[semantic]"' : '"'));
    }
  } catch {
    console.warn(pc.yellow("python not found; build the index later (see docs install-fresh-pc)."));
  }
}

/**
 * Headless / CI path: no prompts. Requires --vault.
 * @param {string[]} argv
 */
async function runNonInteractive(argv) {
  const cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || cwd;
  const lang = langFromArgs();
  const dryRun = dryRunFromArgs();
  const t = messages[lang];
  // Vault path: --vault wins, else the first positional arg, else the default
  // (~/Documents/obsidian-memory-vault). No flag required for the common case.
  const vaultRaw = flagValue(argv, "--vault") || positionalVault(argv);
  const usedDefault = !vaultRaw;
  const vault = path.resolve(cwd, vaultRaw || defaultVaultPath(home));
  // Create a starter vault if the path isn't one yet, instead of erroring — a
  // one-shot install shouldn't require pre-creating the folder by hand.
  let createdVault = false;
  if (!(await fse.pathExists(path.join(vault, ".obsidian")))) {
    // scaffoldNewVault owns the dry-run check (it is the only place that can be
    // sure nothing slipped past it); this branch only records what happened.
    await scaffoldNewVault(vault, lang, dryRun);
    createdVault = !dryRun;
  }
  const full = fullPresetFromArgs();
  const noCursorMcp = argv.includes("--no-cursor-mcp");
  const noGitInit = argv.includes("--no-git-init");
  // The full stack is the DEFAULT (v3.8.1): a bare non-interactive install ships
  // every feature (hybrid + semantic + index + backend + sqlite-vec + rules), exactly
  // as `--full` did. `--minimal` opts back down to plain basic-memory; a granular
  // `--no-<piece>` drops one part; an explicit `--with-hybrid`/`--semantic`/… forces a
  // piece on even under `--minimal`. (`--full`/`--all` stay as aliases — they also flip
  // the IDE default to codex,claude — but no longer gate the feature set.)
  const minimal = argv.includes("--minimal");
  const on = (optIn, optOut) => (argv.includes(optIn) || !minimal) && !argv.includes(optOut);
  let wantHybrid = on("--with-hybrid", "--no-hybrid");
  let wantSemantic = on("--semantic", "--no-semantic");
  let wantBuildIndex = on("--build-index", "--no-build-index");
  let wantInstallBackend = on("--install-backend", "--no-install-backend");
  // sqlite-vec acceleration (ADR-0025): ranking-identical with a safe fallback, so
  // shipping it by default costs nothing where the extension can't load.
  let wantVec = on("--vec", "--no-vec");
  // Cross-encoder reranker (ADR-0026): a heavy, model-dependent precision pass.
  // Strictly opt-in — NOT part of the default/full stack — because it downloads a
  // model on first use and only helps with a strong, content-language-matched model.
  // `--rerank` installs the [rerank] extra and sets OBSIDIAN_MEMORY_RERANK=1.
  let wantRerank = wantHybrid && argv.includes("--rerank");
  // ADR-0038 retrieval levers: pin_failures (resurface recorded lessons on matching
  // tasks) and usage boost (reinforce notes the agent demonstrably used). Pure
  // ranking levers over data that is already collected by default (recall_log),
  // bench-gated in CI — so the default stack ships them ON; --no-pin-failures /
  // --no-usage-boost opt out.
  let wantPinFailures = wantHybrid && on("--pin-failures", "--no-pin-failures");
  let wantUsageBoost = wantHybrid && on("--usage-boost", "--no-usage-boost");
  const wantGitleaks = argv.includes("--with-gitleaks");
  const ides = idesFromArgs(argv, { full });
  // Claude Code only: disable the native per-project auto-memory + install the SessionStart
  // hook so the vault is the single source of truth (ADR-0029). On by default when Claude Code
  // is wired; --minimal opts out (re-add with --native-memory-override), --no-native-memory-override
  // forces it off.
  const wantNativeOverride =
    ides.includes("claude") && on("--native-memory-override", "--no-native-memory-override");
  // ADR-0030: deterministic enforcement hooks (PreToolUse guard + Stop nudge) ride along
  // with the native-memory override by default; --no-memory-enforcement opts out of just
  // these two (keeping autoMemoryEnabled:false + the SessionStart hook).
  const wantEnforce = wantNativeOverride && on("--memory-enforcement", "--no-memory-enforcement");
  // ADR-0031: effort-gate hook (PreToolUse) also rides along by default, independently of
  // --memory-enforcement; --no-effort-gate opts out of just this one.
  const wantEffortGate = wantNativeOverride && on("--effort-gate", "--no-effort-gate");
  // vkm-kit token-saver (ADR-0043, amended): PostToolUse compaction hooks (noisy Bash
  // output; MCP JSON whitespace) + the vkm-terse output style. Claude Code-only; same
  // default-on / --no-X idiom. The terse style gets its own toggle — changing Claude's
  // voice is a preference, not pure noise removal — but ships ON with the rest. The
  // permissions.deny rules were retired (hard blocks obstructed legit reads); reconcile
  // strips them from old installs.
  const wantTokenSaver = ides.includes("claude") && on("--token-saver", "--no-token-saver");
  const wantTerseStyle = wantTokenSaver && on("--terse-style", "--no-terse-style");
  // vkm-kit local telemetry (ADR-0044): OTEL env → local sink (127.0.0.1:4319) so
  // `vkm-doctor` can report real token/cache usage. Needs a kit clone (sink script);
  // silently skipped without one. Data never leaves the machine.
  const wantTelemetry = ides.includes("claude") && on("--telemetry", "--no-telemetry");
  // vkm-kit skills + subagent template (ADR-0049): /vkm-discipline + /vkm-spec skills and
  // the vkm-implementer agent. Pure files under ~/.claude/, hash-tracked.
  const wantSkills = ides.includes("claude") && on("--skills", "--no-skills");
  const wantAgents = ides.includes("claude") && on("--agents", "--no-agents");
  // Ollama + phi4-mini (ADR-0047, ~2.3GB): gated to explicit --full or --ollama — a bare
  // headless install must not surprise anyone with a multi-GB download. --no-ollama wins.
  const wantOllama = (full || argv.includes("--ollama")) && !argv.includes("--no-ollama");
  // obscura-web (ADR-0051): stealth web fetch + robust search via the local obscura browser.
  // Gated to explicit --full or --obscura (downloads a ~40MB third-party binary); --no-obscura wins.
  const wantObscura = (full || argv.includes("--obscura")) && !argv.includes("--no-obscura");
  // vkm-downloads (ADR-0058): guarded file-download manager. Its OWN flag, DELIBERATELY not folded
  // into --full even though --full includes --obscura: this tool WRITES bytes to the user's disk (a
  // different risk surface than obscura's web reads), so opting into web access must never silently
  // grant disk-write capability. Explicit --downloads only; --no-downloads wins.
  const wantDownloads = argv.includes("--downloads") && !argv.includes("--no-downloads");
  let kitRoot = null;

  if (wantHybrid) {
    kitRoot = await resolveKitRepoRoot({ cwd, argv, pathExists: (p) => fse.pathExists(p) });
    const { hybridJs, pythonSrc } = kitRoot
      ? hybridMcpPathsFromKitRoot(kitRoot)
      : { hybridJs: null, pythonSrc: null };
    const ok = kitRoot && (await fse.pathExists(hybridJs)) && (await fse.pathExists(pythonSrc));
    if (!ok) {
      // Explicit --with-hybrid is a hard requirement (fail loud). But the default
      // full stack is "best effort, max power": when there's no kit clone to source
      // the bridge from (e.g. run via bare `npx` outside a clone), degrade to
      // basic-memory instead of aborting the whole install.
      if (!argv.includes("--with-hybrid")) {
        console.warn(
          pc.yellow(
            "No kit clone found, so hybrid/semantic/index/vec are skipped — wiring basic-memory only."
          )
        );
        console.log(
          pc.dim(
            "  For full hybrid power, run from a clone of the kit or pass --repo-root <clone>."
          )
        );
        wantHybrid = false;
        wantSemantic = false;
        wantBuildIndex = false;
        wantInstallBackend = false;
        wantVec = false;
        wantRerank = false;
        wantPinFailures = false;
        wantUsageBoost = false;
        kitRoot = null;
      } else {
        console.error(
          pc.red(
            "--with-hybrid: pass --repo-root <path-to-vkm-kit-clone> or run from that clone (cwd walk), and ensure the bridge + Python src exist."
          )
        );
        process.exit(2);
      }
    }
  }

  // obscura-web needs the kit clone for its MCP bridge path (same as hybrid); resolve it if
  // the hybrid block above didn't, then best-effort install the pinned+verified obscura binary.
  let obscuraBin = null;
  let wantObscuraFinal = wantObscura;
  const searxngUrl = flagValue(argv, "--searxng-url");
  // Default RESEARCH/ persistence root to <vault>/RESEARCH (ADR-0056); the vault path is
  // already known here, same pattern as searxngUrl's override above --obscura-research-dir.
  const researchDir = flagValue(argv, "--obscura-research-dir") || path.join(vault, "RESEARCH");
  if (wantObscuraFinal && !kitRoot) {
    kitRoot = await resolveKitRepoRoot({ cwd, argv, pathExists: (p) => fse.pathExists(p) });
  }
  if (wantObscuraFinal && !kitRoot) {
    console.warn(
      pc.yellow(
        "No kit clone found — obscura-web is skipped (run from a clone or pass --repo-root)."
      )
    );
    wantObscuraFinal = false;
  }
  if (wantObscuraFinal) {
    const r = await maybeInstallObscura(dryRun, { enable: true });
    obscuraBin = r.binPath;
    if (r.status === "manual" || r.status === "failed") {
      console.log(
        pc.dim(
          "  obscura-web MCP stays wired; its tools fall back to native WebFetch/WebSearch until obscura is installed."
        )
      );
    }
  }

  // vkm-downloads (ADR-0058) needs the kit clone for its MCP bridge path (same as hybrid/obscura).
  // No third-party binary to install — pure stdlib — so this only resolves the clone and wires it.
  let wantDownloadsFinal = wantDownloads;
  const downloadDir = flagValue(argv, "--download-dir");
  if (wantDownloadsFinal && !kitRoot) {
    kitRoot = await resolveKitRepoRoot({ cwd, argv, pathExists: (p) => fse.pathExists(p) });
  }
  if (wantDownloadsFinal && !kitRoot) {
    console.warn(
      pc.yellow(
        "No kit clone found — vkm-downloads is skipped (run from a clone or pass --repo-root)."
      )
    );
    wantDownloadsFinal = false;
  }

  console.log(
    pc.cyan(t.title),
    pc.dim(full ? "full preset" : minimal ? "minimal" : "full stack (default)")
  );

  // The canonical server object, NOT a hand-built copy. Both flows used to inline
  // `args: ["basic-memory", "mcp"]` here — dropping the `--from basic-memory==<pin>`
  // that mcp-merge.mjs documents as a supply-chain control (an unpinned `uvx <pkg> mcp`
  // re-resolves from PyPI on every client restart, so a package takeover is an RCE).
  // This object is printed under "paste this MCP block into each IDE's config" for
  // Cline/Windsurf/Zed users and in the run summary, so the one path the installer
  // could not merge for the user was also the one path it handed them unpinned.
  const mcpSnippet = basicMemoryServer(vault);

  const hybridOpts = {
    withHybrid: wantHybrid,
    repoRoot: kitRoot,
    semantic: wantSemantic,
    vec: wantVec,
    rerank: wantRerank,
    pinFailures: wantPinFailures,
    usage: wantUsageBoost,
    obscura: wantObscuraFinal,
    obscuraBin,
    searxngUrl,
    researchDir,
    downloads: wantDownloadsFinal,
    downloadDir
  };
  if (ides.includes("cursor") && !noCursorMcp) {
    await writeCursorMcp(home, vault, dryRun, hybridOpts);
  } else if (ides.includes("cursor") && noCursorMcp) {
    console.log(pc.dim("Skipped Cursor mcp.json (--no-cursor-mcp)"));
  }
  if (ides.includes("claude")) {
    await registerClaudeCodeMcp(vault, dryRun, hybridOpts);
  }
  // Always reconcile (not just install) whenever Claude Code is a wired target for this
  // run: a symmetric call also STRIPS previously-installed pieces a `--no-X` flag now
  // turns off, instead of only ever adding entries (see ADR-0030/0031 install/remove fix).
  if (ides.includes("claude")) {
    // BEFORE the configure* calls: each resolves `hookInterpreter(claudeDir)` once, and the answer
    // is only the launcher if the launcher is already on disk. Installing it afterwards would
    // write a settings.json full of `node` and take another full re-run to correct.
    await installRunHidden(home, dryRun);
    await configureClaudeNativeMemory(home, vault, dryRun, {
      lang,
      enable: wantNativeOverride,
      enforce: wantEnforce,
      effortGate: wantEffortGate
    });
    // Same symmetric-reconcile contract as above: `--no-token-saver` on a re-run strips a
    // previously-installed token-saver instead of merely skipping it.
    await configureTokenSaver(home, dryRun, {
      hooks: wantTokenSaver,
      terseStyle: wantTerseStyle
    });
    await configureTelemetry(home, dryRun, { enable: wantTelemetry, kitRoot });
    await configureSkillAssets(home, dryRun, { skills: wantSkills, agents: wantAgents });
    if (wantOllama) {
      await maybeInstallOllama(dryRun, { enable: true });
    }
  }
  if (ides.includes("codex")) {
    await registerCodexMcp(vault, dryRun, hybridOpts);
  }
  // Install the Python backend before building the index so the build can succeed
  // on a fresh machine in the same run.
  if (wantInstallBackend && kitRoot) {
    await maybeInstallBackend(kitRoot, wantSemantic, dryRun, wantVec, wantRerank);
  }
  if (wantBuildIndex) {
    await maybeBuildIndex(vault, dryRun, { repoRoot: kitRoot, semantic: wantSemantic });
  }

  // Rules ship by default too (part of "everything"); --no-rules / --minimal opt out.
  const ruleTargets = rulesTargetsFromArgs(argv, ides, { full: !minimal });
  const rulesProfile = rulesProfileFromArgs(argv, { minimal });
  if (ruleTargets.length) {
    await installRules(ruleTargets, lang, { home, cwd, dryRun, profile: rulesProfile });
  }

  if (!noGitInit && dryRun) {
    console.log(pc.cyan("[dry-run] would run"), "git init", pc.dim(`(cwd ${vault})`));
  } else if (!noGitInit && !(await fse.pathExists(path.join(vault, ".git")))) {
    await execa("git", ["init"], { cwd: vault, stdio: "inherit" });
  }

  await writeVaultGitWorkspaceSettings(vault, dryRun);
  await maybeInstallGitleaksHook(vault, wantGitleaks, dryRun);

  console.log(pc.green("\n" + t.summary));
  console.log(
    "- Vault:",
    vault + (usedDefault ? " (default)" : "") + (createdVault ? " (created)" : "")
  );
  console.log("- MCP:", JSON.stringify(mcpSnippet));
  if (wantHybrid && kitRoot) {
    console.log("- obsidian-memory-hybrid: merged (kit root", kitRoot + ")");
    const ragPkg = path.join(kitRoot, "packages", "obsidian-memory-rag");
    const extras = [
      wantSemantic ? "semantic" : null,
      wantVec ? "vec" : null,
      wantRerank ? "rerank" : null
    ].filter(Boolean);
    const extraSpec = extras.length ? `[${extras.join(",")}]` : "";
    console.log(pc.dim('  pip install -e "' + ragPkg + extraSpec + '"'));
    if (wantSemantic) {
      console.log(
        pc.dim(
          "  embedder: fastembed (OBSIDIAN_MEMORY_EMBEDDER); build once with vault_fts_index semantic:true"
        )
      );
    }
    if (wantVec) {
      console.log(
        pc.dim(
          "  sqlite-vec acceleration: OBSIDIAN_MEMORY_SQLITE_VEC=1 (ranking-identical; ADR-0025)"
        )
      );
    }
    if (wantRerank) {
      console.log(
        pc.dim(
          "  cross-encoder reranker: OBSIDIAN_MEMORY_RERANK=1 (multilingual model downloads on first use; ADR-0026)"
        )
      );
    }
  }
  if (ides.includes("claude")) {
    console.log(
      "- Claude Code: MCP registered via `claude mcp add -s user` (verify: `claude mcp list`)"
    );
  }
  if (wantNativeOverride) {
    console.log(
      "- Claude Code native memory: DISABLED (autoMemoryEnabled:false) + SessionStart vault hook → ~/.claude/settings.json"
    );
  } else if (ides.includes("claude")) {
    console.log(
      "- Claude Code native memory: left/reverted to Claude's own default (any prior override + hooks from this kit were removed if present)"
    );
  }
  if (wantEnforce) {
    console.log(
      "- Deterministic enforcement (ADR-0030): PreToolUse guard (denies writes into native memory) + Stop nudge (close-ritual reminder) → ~/.claude/settings.json"
    );
  }
  if (wantEffortGate) {
    console.log(
      "- Effort gate (ADR-0031): PreToolUse hook (denies the 2nd+ substantive edit until the model proposes an effort level and the user replies) → ~/.claude/settings.json"
    );
  }
  if (wantTokenSaver) {
    console.log(
      "- Token-saver (ADR-0043): PostToolUse compaction hooks (Bash + mcp__.*) + permissions.deny noise rules" +
        (wantTerseStyle ? " + vkm-terse output style" : "") +
        " → ~/.claude/settings.json (kill switch: VKM_TOKEN_SAVER=0)"
    );
  }
  if (ides.includes("codex")) {
    console.log(
      "- Codex CLI: MCP registered via `codex mcp add` → ~/.codex/config.toml (verify: `codex mcp list`)"
    );
  }
  if (wantGitleaks) {
    console.log("- gitleaks pre-commit hook: installed (vault/.git/hooks/pre-commit)");
  }
  if (ruleTargets.length) {
    console.log("- Memory rules installed into:", ruleTargets.join(", "));
    if (ides.includes("cursor")) {
      console.log(
        pc.dim(
          "  Cursor GLOBAL User Rules can't be auto-written — paste the block from install.md Step 4 into Settings → Rules → User Rules."
        )
      );
    }
  }
  console.log("-", t.ftsHint);
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

  if (argv.includes("--check-update")) {
    const cwd = process.cwd();
    const home = process.env.HOME || process.env.USERPROFILE || cwd;
    const sidecarFp = path.join(home, ".claude", ASSETS_SIDECAR_BASENAME);
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
    const files = skillAssetFiles(home, { skills: true, agents: true });
    const plan = await buildUpdatePlan({ home, files, sidecarFp, managedRoots: updateRoots(home) });
    console.log(summarizePlan(plan));
    return;
  }

  if (argv.includes("--update")) {
    const cwd = process.cwd();
    const home = process.env.HOME || process.env.USERPROFILE || cwd;
    const sidecarFp = path.join(home, ".claude", ASSETS_SIDECAR_BASENAME);
    const dryRun = dryRunFromArgs();
    const force = argv.includes("--force");
    if (dryRun) console.log(pc.dim("[dry-run] no files will be written"));
    const files = skillAssetFiles(home, { skills: true, agents: true });
    const plan = await buildUpdatePlan({ home, files, sidecarFp, managedRoots: updateRoots(home) });
    console.log(summarizePlan(plan));
    const { applied, skipped, removed } = await applyUpdatePlan({ plan, sidecarFp, force, dryRun });
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
    await uninstallSkillAssets(home, dryRun);
    await uninstallRunHidden(home, dryRun);
    return;
  }

  if (nonInteractiveFromArgs()) {
    await runNonInteractive(argv);
    return;
  }

  const lang = langFromArgs();
  const dryRun = dryRunFromArgs();
  const t = messages[lang];
  // The real installed version, not a hardcoded string: this banner still read
  // "v2 / v3" on a 4.x kit, so the one place every user sees a version was the one
  // place guaranteed to be wrong. readKitVersion() is already the source of truth
  // for --check-update and the sidecar's kitVersion.
  console.log(pc.cyan(t.title), pc.dim(`v${readKitVersion()}`));
  if (dryRun) console.log(pc.dim("dry-run: Cursor mcp.json will not be written"));

  const cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || cwd;
  const posVault = positionalVault(argv);
  let vault = posVault ? path.resolve(cwd, posVault) : await findVault(cwd, home);

  // A positional path that isn't a vault yet → scaffold it, no prompt needed.
  if (vault && !(await fse.pathExists(path.join(vault, ".obsidian")))) {
    await scaffoldNewVault(vault, lang, dryRun);
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

  const { ides } = await prompts({
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

  const { gitleaks } = await prompts({
    type: "confirm",
    name: "gitleaks",
    message: t.gitleaks,
    initial: true
  });

  // Removed in 5.0: the "Enable age encryption" and "Install obsidian-memoryd user
  // service" prompts installed nothing. Answering yes to the second one printed the
  // command you still had to run yourself — a wizard that asks for consent and then
  // does not act teaches users to distrust everything else it reports. The daemon
  // command survives as an unconditional next-step line below; age was only ever a
  // one-line reminder and belongs in the docs, not in a confirm dialog.

  let hybridOpts = { withHybrid: false, repoRoot: null };
  if (ides?.includes("cursor") || ides?.includes("claude") || ides?.includes("codex")) {
    const kitRoot = await resolveKitRepoRoot({
      cwd,
      argv: process.argv,
      pathExists: (p) => fse.pathExists(p)
    });
    if (kitRoot) {
      const { hybrid } = await prompts({
        type: "confirm",
        name: "hybrid",
        message: t.hybridQ,
        initial: true
      });
      if (hybrid) {
        const { hybridJs, pythonSrc } = hybridMcpPathsFromKitRoot(kitRoot);
        if ((await fse.pathExists(hybridJs)) && (await fse.pathExists(pythonSrc))) {
          const { semantic } = await prompts({
            type: "confirm",
            name: "semantic",
            message: t.semanticQ,
            initial: true
          });
          // vec (sqlite-vec acceleration) rides along with hybrid: ranking-identical
          // and falls back safely, so the default install ships it (ADR-0025).
          // Same deal for the ADR-0038 retrieval levers (pin_failures + usage boost):
          // ranking-only, bench-gated, data already collected by default.
          hybridOpts = {
            withHybrid: true,
            repoRoot: kitRoot,
            semantic: Boolean(semantic),
            vec: true,
            pinFailures: true,
            usage: true
          };
        } else {
          console.warn(pc.yellow("Hybrid paths not found; skipping obsidian-memory-hybrid."));
        }
      }
    }
  }

  // The canonical server object, NOT a hand-built copy. Both flows used to inline
  // `args: ["basic-memory", "mcp"]` here — dropping the `--from basic-memory==<pin>`
  // that mcp-merge.mjs documents as a supply-chain control (an unpinned `uvx <pkg> mcp`
  // re-resolves from PyPI on every client restart, so a package takeover is an RCE).
  // This object is printed under "paste this MCP block into each IDE's config" for
  // Cline/Windsurf/Zed users and in the run summary, so the one path the installer
  // could not merge for the user was also the one path it handed them unpinned.
  const mcpSnippet = basicMemoryServer(vault);

  if (ides?.includes("cursor")) {
    await writeCursorMcp(home, vault, dryRun, hybridOpts);
  }
  if (ides?.includes("claude")) {
    await registerClaudeCodeMcp(vault, dryRun, hybridOpts);
  }
  // Claude Code only: vault > native auto-memory (ADR-0029). On by default when Claude Code
  // is selected; opt out with --no-native-memory-override.
  const wantNativeOverride =
    Boolean(ides?.includes("claude")) && !process.argv.includes("--no-native-memory-override");
  // ADR-0030: deterministic enforcement hooks ride along by default; opt out with
  // --no-memory-enforcement (keeps autoMemoryEnabled:false + the SessionStart hook).
  const wantEnforce = wantNativeOverride && !process.argv.includes("--no-memory-enforcement");
  // ADR-0031: effort-gate hook also rides along by default, independently of
  // --memory-enforcement; opt out with --no-effort-gate.
  const wantEffortGate = wantNativeOverride && !process.argv.includes("--no-effort-gate");
  // Always reconcile (not just install) whenever Claude Code was selected: a symmetric call
  // also STRIPS previously-installed pieces `--no-native-memory-override`/`--no-memory-enforcement`/
  // `--no-effort-gate` now turn off, instead of only ever adding entries.
  // vkm-kit token-saver (ADR-0043) rides along in the wizard too; opt out with
  // --no-token-saver / --no-terse-style.
  const wantTokenSaver =
    Boolean(ides?.includes("claude")) && !process.argv.includes("--no-token-saver");
  const wantTerseStyle = wantTokenSaver && !process.argv.includes("--no-terse-style");
  if (ides?.includes("claude")) {
    // Same ordering rule as the headless path: the launcher must exist before any factory
    // resolves the interpreter it bakes into settings.json.
    await installRunHidden(home, dryRun);
    await configureClaudeNativeMemory(home, vault, dryRun, {
      lang,
      enable: wantNativeOverride,
      enforce: wantEnforce,
      effortGate: wantEffortGate
    });
    await configureTokenSaver(home, dryRun, {
      hooks: wantTokenSaver,
      terseStyle: wantTerseStyle
    });
    await configureTelemetry(home, dryRun, {
      // Independent of wantTokenSaver — telemetry is its own ADR-0044 toggle
      // (matches the headless path's `wantTelemetry` below); coupling it to
      // token-saver meant --no-token-saver on a rerun silently stripped a
      // previously-installed telemetry sink the user never asked to touch.
      enable: Boolean(ides?.includes("claude")) && !process.argv.includes("--no-telemetry"),
      kitRoot: hybridOpts.repoRoot || null
    });
    await configureSkillAssets(home, dryRun, {
      skills: !process.argv.includes("--no-skills"),
      agents: !process.argv.includes("--no-agents")
    });
  }
  if (ides?.includes("codex")) {
    await registerCodexMcp(vault, dryRun, hybridOpts);
  }

  let ruleTargets = rulesTargetsFromArgs(process.argv, ides || [], { defaultFromIde: true });
  if (ruleTargets.length && !process.argv.includes("--no-rules")) {
    const { rules } = await prompts({
      type: "confirm",
      name: "rules",
      message: t.rulesQ,
      initial: true
    });
    if (!rules) ruleTargets = [];
  }
  if (ruleTargets.length) {
    await installRules(ruleTargets, lang, {
      home,
      cwd,
      dryRun,
      profile: rulesProfileFromArgs(process.argv)
    });
  }

  const others = (ides || []).filter((x) => x !== "cursor" && x !== "claude" && x !== "codex");
  if (others.length) {
    console.log(pc.yellow(t.otherIdes), others.join(", "));
    console.log(JSON.stringify({ mcpServers: { "basic-memory": mcpSnippet } }, null, 2));
  }

  if (dryRun) {
    console.log(pc.cyan("[dry-run] would run"), "git init", pc.dim(`(cwd ${vault})`));
  } else if (!(await fse.pathExists(path.join(vault, ".git")))) {
    await execa("git", ["init"], { cwd: vault, stdio: "inherit" });
  }

  await writeVaultGitWorkspaceSettings(vault, dryRun);
  await maybeInstallGitleaksHook(vault, Boolean(gitleaks), dryRun);

  console.log(pc.green("\n" + t.summary));
  console.log("- Vault:", vault);
  console.log("- MCP:", JSON.stringify(mcpSnippet));
  if (hybridOpts.withHybrid && hybridOpts.repoRoot) {
    console.log("- obsidian-memory-hybrid: enabled (kit", hybridOpts.repoRoot + ")");
    const ragPkg = path.join(hybridOpts.repoRoot, "packages", "obsidian-memory-rag");
    const extras = [hybridOpts.semantic ? "semantic" : null, hybridOpts.vec ? "vec" : null].filter(
      Boolean
    );
    console.log(
      pc.dim('  pip install -e "' + ragPkg + (extras.length ? `[${extras.join(",")}]` : "") + '"')
    );
    if (hybridOpts.semantic) {
      console.log(pc.dim("  embedder: fastembed; build once with vault_fts_index semantic:true"));
    }
    if (hybridOpts.vec) {
      console.log(pc.dim("  sqlite-vec acceleration: OBSIDIAN_MEMORY_SQLITE_VEC=1 (ADR-0025)"));
    }
  }
  if (ides?.includes("claude")) {
    console.log(
      "- Claude Code: MCP registered via `claude mcp add -s user` (verify: `claude mcp list`)"
    );
  }
  if (wantNativeOverride) {
    console.log(
      "- Claude Code native memory: DISABLED (autoMemoryEnabled:false) + SessionStart vault hook → ~/.claude/settings.json"
    );
  } else if (ides?.includes("claude")) {
    console.log(
      "- Claude Code native memory: left/reverted to Claude's own default (any prior override + hooks from this kit were removed if present)"
    );
  }
  if (wantEnforce) {
    console.log(
      "- Deterministic enforcement (ADR-0030): PreToolUse guard (denies writes into native memory) + Stop nudge (close-ritual reminder) → ~/.claude/settings.json"
    );
  }
  if (wantEffortGate) {
    console.log(
      "- Effort gate (ADR-0031): PreToolUse hook (denies the 2nd+ substantive edit until the model proposes an effort level and the user replies) → ~/.claude/settings.json"
    );
  }
  if (ides?.includes("codex")) {
    console.log(
      "- Codex CLI: MCP registered via `codex mcp add` → ~/.codex/config.toml (verify: `codex mcp list`)"
    );
  }
  console.log("-", t.ftsHint);
  if (gitleaks)
    console.log(
      "- gitleaks pre-commit hook: installed (vault/.git/hooks/pre-commit); install gitleaks CLI to activate"
    );
  console.log(
    "- Optional git sync daemon:",
    "`obsidian-memoryd service install --user && obsidian-memoryd service start`"
  );
  if (ruleTargets.length) {
    console.log("- Memory rules installed into:", ruleTargets.join(", "));
    if (ides?.includes("cursor")) {
      console.log(
        pc.dim(
          "  Cursor GLOBAL User Rules can't be auto-written — paste install.md Step 4 into Settings → Rules → User Rules."
        )
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
