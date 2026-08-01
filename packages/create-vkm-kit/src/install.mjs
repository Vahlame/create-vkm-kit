/**
 * The one install path.
 *
 * # Why there is only one
 *
 * `--yes` and the wizard used to be separate implementations of the same job — 363 lines
 * and 279 lines — and they drifted. The interactive path, which is the DEFAULT, had no
 * notion of obscura, downloads, Ollama, the Python backend or the index build, so
 * `npx create-vkm-kit --obscura` silently wired nothing while `npx create-vkm-kit -y`
 * installed the full stack. Its summary was a near-clone that forgot to mention the
 * token-saver it had just installed.
 *
 * Now the wizard's only job is to produce the same options object the flag parser
 * produces (`cli/options.mjs`), and both call in here. A feature added to the installer
 * cannot reach one flow and miss the other, because there is one flow.
 *
 * @module
 */
import path from "node:path";
import { execa } from "execa";
import fse from "fs-extra";
import pc from "picocolors";
import {
  basicMemoryServer,
  hybridMcpPathsFromKitRoot,
  resolveKitRepoRoot,
  resolveLauncher,
  SEMANTIC_EMBEDDER
} from "./mcp-merge.mjs";
import { registerClaudeCodeMcp, registerCodexMcp, writeCursorMcp } from "./mcp-register.mjs";
import { installRules } from "./rules-merge.mjs";
import { configureClaudeNativeMemory } from "./claude-native-memory.mjs";
import { configureTokenSaver } from "./token-saver.mjs";
import { configureTelemetry } from "./telemetry.mjs";
import { installRunHidden } from "./runhidden-setup.mjs";
import { configureSkillAssets, installSkillsInto, SKILL_NAMES } from "./skills-install.mjs";
import { configureCodexNative } from "./codex-native.mjs";
import { maybeInstallOllama } from "./ollama-setup.mjs";
import { maybeInstallObscura } from "./obscura-setup.mjs";
import { writeVaultGitWorkspaceSettings } from "./vault-scaffold.mjs";
import { messages } from "./i18n.mjs";

/**
 * Locate the kit clone this install can run bridges from, and turn OFF every option that
 * needs one when there is none.
 *
 * "Best effort, max power" is the contract: the default stack degrades to basic-memory
 * with a warning rather than aborting, because a bare `npx` outside a clone is a normal
 * way to run this. The ONE exception is an explicit `--with-hybrid`, which is a hard
 * requirement the user typed and must fail loudly rather than silently do less.
 *
 * Mutates and returns `opts` — callers pass the object they intend to install with, and
 * the summary later reports what actually happened, not what was asked for.
 *
 * @param {import("./cli/options.mjs").InstallOptions} opts
 * @param {{ argv: string[], cwd: string }} ctx
 * @returns {Promise<string|null>} the kit root, or null
 */
async function resolveKitRootAndDegrade(opts, { argv, cwd }) {
  const needsKit = opts.withHybrid || opts.obscura || opts.downloads;
  const kitRoot = needsKit
    ? await resolveKitRepoRoot({ cwd, argv, pathExists: (p) => fse.pathExists(p) })
    : null;

  if (opts.withHybrid) {
    const { hybridJs, pythonSrc } = kitRoot
      ? hybridMcpPathsFromKitRoot(kitRoot)
      : { hybridJs: null, pythonSrc: null };
    const ok = kitRoot && (await fse.pathExists(hybridJs)) && (await fse.pathExists(pythonSrc));
    if (!ok) {
      if (argv.includes("--with-hybrid")) {
        console.error(
          pc.red(
            "--with-hybrid: pass --repo-root <path-to-vkm-kit-clone> or run from that clone " +
              "(cwd walk), and ensure the bridge + Python src exist."
          )
        );
        process.exit(2);
      }
      console.warn(
        pc.yellow(
          "No kit clone found, so hybrid/semantic/index/vec are skipped — wiring basic-memory only."
        )
      );
      console.log(
        pc.dim("  For full hybrid power, run from a clone of the kit or pass --repo-root <clone>.")
      );
      Object.assign(opts, {
        withHybrid: false,
        semantic: false,
        buildIndex: false,
        installBackend: false,
        vec: false,
        rerank: false,
        pinFailures: false,
        usage: false
      });
      return null;
    }
  }

  for (const [flag, label] of /** @type {const} */ ([
    ["obscura", "obscura-web"],
    ["downloads", "vkm-downloads"]
  ])) {
    if (opts[flag] && !kitRoot) {
      console.warn(
        pc.yellow(
          `No kit clone found — ${label} is skipped (run from a clone or pass --repo-root).`
        )
      );
      opts[flag] = false;
    }
  }
  return kitRoot;
}

/**
 * Install the Python RAG backend editable (`pip install -e <rag>[extras]`) so the hybrid
 * MCP + index build work without a separate manual step. Best-effort: prints the command
 * if pip/python is missing or the install fails. Lifted verbatim from the pre-5.0
 * `index.js` — the details here (which extras compose the spec, the exact fallback text)
 * are the contract users see when it cannot run.
 * @param {string|null} repoRoot
 * @param {boolean} semantic
 * @param {boolean} dryRun
 * @param {boolean} [vec] also install the `[vec]` extra (sqlite-vec; ADR-0025)
 * @param {boolean} [rerank] also install the `[rerank]` extra (cross-encoder; ADR-0026)
 */
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
 * Install a gitleaks `pre-commit` hook in the vault repo so secrets caught at commit time
 * block both the user's interactive commits AND the obsidian-memoryd daemon's auto-commits.
 * Falls through with a warning if gitleaks is not on PATH at commit time — it does not
 * hard-fail commits when the tool isn't installed.
 * @param {string} vault
 * @param {boolean} enable
 * @param {boolean} dryRun
 */
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
 * Run the install described by `opts`.
 *
 * @param {object} ctx
 * @param {string[]} ctx.argv
 * @param {string} ctx.home
 * @param {string} ctx.cwd
 * @param {string} ctx.vault absolute vault path (already scaffolded if it was new)
 * @param {string[]} ctx.ides
 * @param {import("./cli/options.mjs").InstallOptions} ctx.opts
 * @returns {Promise<{ kitRoot: string|null, obscuraBin: string|null, launcher: string|null }>}
 *   what actually landed — `launcher` is threaded to `printSummary` so the block it prints
 *   is the one that was registered, rather than a second guess at it
 */
export async function runInstall({ argv, home, cwd, vault, ides, opts }) {
  const { dryRun, lang } = opts;
  const kitRoot = await resolveKitRootAndDegrade(opts, { argv, cwd });

  let obscuraBin = null;
  if (opts.obscura) {
    const r = await maybeInstallObscura(dryRun, { enable: true });
    obscuraBin = r.binPath;
    if (r.status === "manual" || r.status === "failed") {
      console.log(
        pc.dim(
          "  obscura-web MCP stays wired; its tools fall back to native WebFetch/WebSearch " +
            "until obscura is installed."
        )
      );
    }
  }

  // BEFORE anything that writes a `command` string: the MCP registrations below and the
  // configure* calls further down both start servers/hooks through this launcher, and both
  // used to find it by PROBING the disk — so whatever ran before it was put there got wired
  // to bare `node`/`uvx` and took another full re-run to correct. It used to sit BETWEEN the
  // two, which meant a FIRST install on a machine with no `~/.claude/bin` wrote exactly the
  // flashing-console config ADR-0078 exists to prevent: the hooks were fixed and the four MCP
  // servers, registered moments earlier, were not. Unconditional (not inside the `claude`
  // branch) because a Cursor-only install writes MCP commands too; no-op off Windows,
  // idempotent on it. Its return value is THREADED below rather than re-probed, so the
  // registrations state the answer this install just produced instead of asking the
  // filesystem again and hoping the order held.
  const launcher =
    (await installRunHidden(home, dryRun, { repoRoot: kitRoot })) ??
    resolveLauncher(path.join(home, ".claude"));

  const serverOpts = {
    withHybrid: opts.withHybrid,
    repoRoot: kitRoot,
    semantic: opts.semantic,
    vec: opts.vec,
    rerank: opts.rerank,
    pinFailures: opts.pinFailures,
    usage: opts.usage,
    obscura: opts.obscura,
    obscuraBin,
    searxngUrl: opts.searxngUrl,
    researchDir: opts.researchDir,
    downloads: opts.downloads,
    downloadDir: opts.downloadDir,
    launcher
  };

  if (ides.includes("cursor")) {
    if (opts.noCursorMcp) console.log(pc.dim("Skipped Cursor mcp.json (--no-cursor-mcp)"));
    else await writeCursorMcp(home, vault, dryRun, serverOpts);
  }
  if (ides.includes("claude")) {
    await registerClaudeCodeMcp(vault, dryRun, serverOpts);
    // Every configure* call RECONCILES rather than merely installs: a `--no-X` on a re-run
    // strips what a previous run added, instead of only ever adding entries.
    await configureClaudeNativeMemory(home, vault, dryRun, {
      lang,
      enable: opts.nativeOverride,
      enforce: opts.enforce,
      effortGate: opts.effortGate
    });
    await configureTokenSaver(home, dryRun, {
      hooks: opts.tokenSaver,
      terseStyle: opts.terseStyle
    });
    await configureTelemetry(home, dryRun, { enable: opts.telemetry, kitRoot });
    await configureSkillAssets(home, dryRun, {
      ide: "claude",
      skills: opts.skills,
      agents: opts.agents
    });
    if (opts.ollama) await maybeInstallOllama(dryRun, { enable: true });
  }
  if (ides.includes("codex")) {
    await registerCodexMcp(vault, dryRun, serverOpts);
    await configureCodexNative(home, vault, dryRun, {
      lang,
      hooks: opts.codexHooks,
      context: opts.codexContext,
      memoryGuard: opts.codexMemoryGuard,
      effortGate: opts.codexEffortGate,
      tokenSaver: opts.codexTokenSaver,
      // Same launcher the Claude hooks and the MCP servers were just wired to — threaded, not
      // re-probed, so Codex stops being the one surface that still flashes a console.
      launcher
    });
    await configureSkillAssets(home, dryRun, {
      ide: "codex",
      skills: opts.skills,
      agents: opts.agents
    });
  }
  // Generic skills target (compatibility with clients the kit has no --ide for yet:
  // Kimi Code, opencode, ...). Additive and independent of the --ide list; the skills
  // are plain markdown + portable Node scripts, consumable by any client with a skills
  // folder. Re-run with the same path to update.
  if (opts.skillsDir) await installSkillsInto(opts.skillsDir, dryRun);

  // Backend before index, so a fresh machine can build in the same run.
  if (opts.installBackend) {
    await maybeInstallBackend(kitRoot, opts.semantic, opts.dryRun, opts.vec, opts.rerank);
  }
  if (opts.buildIndex) {
    await maybeBuildIndex(vault, opts.dryRun, { repoRoot: kitRoot, semantic: opts.semantic });
  }

  if (opts.ruleTargets.length) {
    await installRules(opts.ruleTargets, lang, {
      home,
      cwd,
      dryRun,
      profile: opts.rulesProfile
    });
  }

  if (!opts.noGitInit) {
    if (dryRun) {
      console.log(pc.cyan("[dry-run] would run"), "git init", pc.dim(`(cwd ${vault})`));
    } else if (!(await fse.pathExists(path.join(vault, ".git")))) {
      await execa("git", ["init"], { cwd: vault, stdio: "inherit" });
    }
  }

  await writeVaultGitWorkspaceSettings(vault, dryRun);
  await maybeInstallGitleaksHook(vault, opts.gitleaks, dryRun);

  return { kitRoot, obscuraBin, launcher };
}

/**
 * Report what this run installed.
 *
 * Both flows printed their own near-clone of this, and the interactive one was missing
 * lines for things it had just done (the token-saver, telemetry, skills) — a summary that
 * under-reports is how a user concludes a feature did not install.
 *
 * @param {object} ctx
 * @param {string} ctx.vault
 * @param {string[]} ctx.ides
 * @param {import("./cli/options.mjs").InstallOptions} ctx.opts
 * @param {{ kitRoot: string|null, launcher?: string|null }} ctx.result
 * @param {{ usedDefault?: boolean, createdVault?: boolean }} [ctx.meta]
 */
export function printSummary({ vault, ides, opts, result, meta = {} }) {
  const t = messages[opts.lang];
  const { kitRoot } = result;
  const line = (s) => console.log(s);

  console.log(pc.green("\n" + t.summary));
  line(
    `- Vault: ${vault}${meta.usedDefault ? " (default)" : ""}${meta.createdVault ? " (created)" : ""}`
  );
  // The SAME object that was registered, launcher and all. Printing the un-launched form
  // would hand Cline/Windsurf/Zed users a config that differs from every other client's —
  // and specifically the one that flashes a console window (ADR-0078). It takes the answer
  // the install RETURNED; re-probing here would agree only as long as the two stayed in
  // sync, which is the assumption that broke in the first place.
  const server = basicMemoryServer(vault, {
    launcher: result.launcher !== undefined ? result.launcher : resolveLauncher()
  });
  line(`- MCP: ${JSON.stringify(server)}`);

  // Clients the kit cannot write config for get the block to paste. This used to exist
  // only in the wizard, so a headless install that selected them printed nothing.
  const others = ides.filter((x) => !["cursor", "claude", "codex"].includes(x));
  if (others.length) {
    console.log(pc.yellow(t.otherIdes), others.join(", "));
    console.log(JSON.stringify({ mcpServers: { "basic-memory": server } }, null, 2));
  }

  if (opts.withHybrid && kitRoot) {
    line(`- obsidian-memory-hybrid: merged (kit root ${kitRoot})`);
    const extras = [opts.semantic && "semantic", opts.vec && "vec", opts.rerank && "rerank"].filter(
      Boolean
    );
    const ragPkg = path.join(kitRoot, "packages", "obsidian-memory-rag");
    console.log(
      pc.dim(`  pip install -e "${ragPkg}${extras.length ? `[${extras.join(",")}]` : ""}"`)
    );
    if (opts.semantic) {
      console.log(
        pc.dim(
          "  embedder: fastembed (OBSIDIAN_MEMORY_EMBEDDER); build once with vault_fts_index semantic:true"
        )
      );
    }
    if (opts.vec) {
      console.log(
        pc.dim(
          "  sqlite-vec acceleration: OBSIDIAN_MEMORY_SQLITE_VEC=1 (ranking-identical; ADR-0025)"
        )
      );
    }
    if (opts.rerank) {
      console.log(
        pc.dim(
          "  cross-encoder reranker: OBSIDIAN_MEMORY_RERANK=1 (multilingual model downloads on first use; ADR-0026)"
        )
      );
    }
  }
  if (opts.obscura) line("- obscura-web: wired (stealth fetch + search + local deep research)");
  if (opts.downloads) line("- vkm-downloads: wired (guarded file downloads)");

  if (ides.includes("claude")) {
    line("- Claude Code: MCP registered via `claude mcp add -s user` (verify: `claude mcp list`)");
    line(
      opts.nativeOverride
        ? "- Claude Code native memory: DISABLED (autoMemoryEnabled:false) + SessionStart vault hook → ~/.claude/settings.json"
        : "- Claude Code native memory: left/reverted to Claude's own default (any prior override + hooks from this kit were removed if present)"
    );
  }
  if (opts.enforce) {
    line(
      "- Deterministic enforcement (ADR-0030): PreToolUse guard (denies writes into native memory) + Stop nudge (close-ritual reminder) → ~/.claude/settings.json"
    );
  }
  if (opts.effortGate) {
    line(
      "- Effort advisor (ADR-0081): PreToolUse hook (persists the effort level the work calls for; one user-only notice, never blocks a tool call) → ~/.claude/settings.json"
    );
  }
  if (opts.tokenSaver) {
    line(
      "- Token-saver (ADR-0043): PostToolUse compaction hooks (Bash + mcp__.*)" +
        (opts.terseStyle ? " + vkm-terse output style" : "") +
        " → ~/.claude/settings.json (kill switch: VKM_TOKEN_SAVER=0)"
    );
  }
  if (opts.telemetry) line("- Local telemetry (ADR-0044): OTLP sink on 127.0.0.1:4319 → ~/.vkm/");
  // Derived from what the installer actually copies. The hand-written list here still said
  // four skills the run after a fifth shipped — a summary that under-reports is how a user
  // concludes a feature did not install.
  if (opts.skills) line(`- Skills installed: ${SKILL_NAMES.map((n) => `/${n}`).join(", ")}`);
  if (ides.includes("codex")) {
    line(
      "- Codex CLI: MCP registered via `codex mcp add` → ~/.codex/config.toml (verify: `codex mcp list`)"
    );
  }
  if (ides.includes("codex") && opts.codexHooks) {
    line("- Codex hooks: SessionStart, PreToolUse and PostToolUse → ~/.codex/hooks.json");
  }
  if (opts.gitleaks) line("- gitleaks pre-commit hook: installed (vault/.git/hooks/pre-commit)");
  if (opts.ruleTargets.length) {
    line(`- Memory rules installed into: ${opts.ruleTargets.join(", ")}`);
    if (ides.includes("cursor")) {
      console.log(
        pc.dim(
          "  Cursor GLOBAL User Rules can't be auto-written — paste the block from install.md Step 4 into Settings → Rules → User Rules."
        )
      );
    }
  }
  line(
    "- Optional git sync daemon: `obsidian-memoryd service install --user && obsidian-memoryd service start`"
  );
  line(`- ${t.ftsHint}`);
}
