#!/usr/bin/env node
/**
 * @vkmikc/create-obsidian-memory — interactive initializer (v2 / v3).
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
  mergeBasicMemoryServer,
  mergeObsidianHybridServer,
  resolveKitRepoRoot,
  hybridMcpPathsFromKitRoot,
  flagValue,
  basicMemoryServer,
  hybridServer,
  claudeAddArgv,
  claudeRemoveArgv,
  codexAddArgv,
  codexRemoveArgv,
  codexTomlBlock,
  SEMANTIC_EMBEDDER
} from "./mcp-merge.mjs";
import { installRules } from "./rules-merge.mjs";

/** Cursor/VS Code workspace defaults: fewer `git` + `conhost` spikes on Windows (SCM polling). */
const VAULT_VSCODE_GIT_SETTINGS = {
  "git.autoRepositoryDetection": false,
  "git.autorefresh": false,
  "git.autofetch": false,
  "git.terminalAuthentication": false,
  "git.decorations.enabled": false,
  "git.timeline.enabled": false,
  "git.blame.editorDecoration.enabled": false,
  "git.blame.statusBarItem.enabled": false,
  "git.showProgress": false,
  "npm.autoDetect": "off",
  "files.watcherExclude": {
    "**/node_modules/**": true,
    "**/bin/**": true,
    "**/dist/**": true,
    "**/.cursor/**": true,
    "**/packages/**/node_modules/**": true,
    "**/.pytest_cache/**": true,
    "**/coverage/**": true,
    "**/.venv/**": true,
    "**/__pycache__/**": true,
    "**/.obsidian/**": true,
    "**/go.work.sum": true,
    "**/.git/objects/**": true,
    "**/.git/lfs/**": true
  }
};

const messages = {
  es: {
    title: "create-obsidian-memory",
    vaultQ: "Ruta del vault (debe contener .obsidian o crearemos uno)",
    createVault: "Crear un vault nuevo en ~/Documents/obsidian-memory-vault",
    ides: "IDEs a configurar (espacio para MCP)",
    gitleaks: "Activar hook pre-commit gitleaks",
    age: "Activar cifrado age para datos sensibles (mas friccion)",
    daemon: "Instalar obsidian-memoryd como servicio de usuario",
    summary: "Listo. Pasos siguientes",
    otherIdes: "Copia este bloque MCP en la config del IDE:",
    ftsHint:
      "Opcional (vaults grandes): MCP obsidian-memory-hybrid (tras pip install -e …/obsidian-memory-rag) o obsidian-memory-rag index manual; ver docs/es/instalacion.md (Verificación).",
    hybridQ:
      "¿Añadir MCP obsidian-memory-hybrid (FTS5 / BM25) además de basic-memory? (requiere clon del kit y pip install -e packages/obsidian-memory-rag)",
    semanticQ:
      "¿Usar embeddings neuronales (fastembed) para recall por significado? (requiere el extra [semantic])",
    rulesQ:
      "¿Instalar las reglas de memoria en CLAUDE.md / AGENTS.md / .cursor? (bloque marcado; no pisa tu contenido)"
  },
  en: {
    title: "create-obsidian-memory",
    vaultQ: "Vault path (must contain .obsidian or we create a sample)",
    createVault: "Create a new vault at ~/Documents/obsidian-memory-vault",
    ides: "IDEs to wire for MCP",
    gitleaks: "Enable gitleaks pre-commit hook",
    age: "Enable age encryption (more friction)",
    daemon: "Install obsidian-memoryd user service",
    summary: "Done. Next steps",
    otherIdes: "Paste this MCP block into each IDE's config:",
    ftsHint:
      "Optional (large vaults): obsidian-memory-hybrid MCP (after pip install -e …/obsidian-memory-rag) or manual obsidian-memory-rag index; see docs/en/install.md (Verification).",
    hybridQ:
      "Add obsidian-memory-hybrid MCP (FTS5 / BM25) in addition to basic-memory? (needs this repo clone + pip install -e packages/obsidian-memory-rag)",
    semanticQ:
      "Use neural embeddings (fastembed) for meaning-based recall? (needs the [semantic] extra)",
    rulesQ:
      "Install the memory rules into CLAUDE.md / AGENTS.md / .cursor? (marked block; won't clobber your content)"
  }
};

function langFromArgs() {
  const i = process.argv.indexOf("--lang");
  if (i >= 0 && process.argv[i + 1] === "en") return "en";
  return "es";
}

function dryRunFromArgs() {
  return process.argv.includes("--dry-run");
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
const VALUE_FLAGS = new Set(["--vault", "--ide", "--repo-root", "--lang", "--rules"]);

/**
 * First bare (non-flag) CLI argument = vault path shorthand, so you can write
 * `create-obsidian-memory ./my-vault` instead of `--vault ./my-vault`.
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

/** Default vault when none is given: ~/Documents/obsidian-memory-vault. */
function defaultVaultPath(home) {
  return path.join(home, "Documents", "obsidian-memory-vault");
}

/**
 * Which agent-config files to install the memory-rules block into. Derived from
 * --ide (wiring an IDE also drops its rules) unless overridden:
 *   --no-rules / --rules none → []   ·   --rules all → claude+agents+cursor+codex
 *   --rules a,b → explicit    ·   --full or interactive default → agents + the
 *   global rules file for each wired agent (claude/codex/cursor)
 * @param {string[]} argv
 * @param {string[]} ides
 * @param {{ defaultFromIde?: boolean, full?: boolean }} [opts]
 * @returns {string[]}
 */
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

/** Project AGENTS.md + the global rules file for each wired agent. */
function rulesFromIdes(ides) {
  const targets = ["agents"];
  if (ides.includes("claude")) targets.push("claude");
  if (ides.includes("codex")) targets.push("codex");
  if (ides.includes("cursor")) targets.push("cursor");
  return targets;
}

async function findVault(cwd, home) {
  let cur = cwd;
  for (let i = 0; i < 6; i++) {
    if (await fse.pathExists(path.join(cur, ".obsidian"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const h = path.join(home, "Documents");
  if (await fse.pathExists(path.join(h, ".obsidian"))) return h;
  return null;
}

/**
 * Merges kit Git/SCM tuning into `<vault>/.vscode/settings.json` (creates or updates).
 * Kit keys win for known tuning; `files.watcherExclude` is merged with existing entries.
 * @param {string} vault
 * @param {boolean} dryRun
 */
async function writeVaultGitWorkspaceSettings(vault, dryRun) {
  const fp = path.join(vault, ".vscode", "settings.json");
  if (dryRun) {
    console.log(pc.cyan("[dry-run] would merge"), fp);
    return;
  }
  await fse.ensureDir(path.dirname(fp));
  const existedBefore = await fse.pathExists(fp);
  let existing = {};
  if (existedBefore) {
    try {
      const raw = (await fse.readFile(fp, "utf8")).trim().replace(/^\uFEFF/, "");
      if (raw) existing = JSON.parse(raw);
    } catch {
      const bak = `${fp}.bak.${Date.now()}`;
      await fse.copy(fp, bak);
      console.warn(pc.yellow("Invalid JSON in vault .vscode/settings.json; backed up to"), bak);
      existing = {};
    }
  }
  const merged = { ...existing };
  for (const [key, value] of Object.entries(VAULT_VSCODE_GIT_SETTINGS)) {
    if (key === "files.watcherExclude" && value && typeof value === "object") {
      const prev = existing[key] && typeof existing[key] === "object" ? existing[key] : {};
      merged[key] = { ...prev, ...value };
    } else {
      merged[key] = value;
    }
  }
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\cmd\\git.exe",
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe")
    ];
    const pf86 = process.env["ProgramFiles(x86)"];
    if (pf86) candidates.push(path.join(pf86, "Git", "cmd", "git.exe"));
    for (const g of candidates) {
      if (g && (await fse.pathExists(g))) {
        merged["git.path"] = g;
        break;
      }
    }
  }
  await fse.writeFile(fp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(pc.green(existedBefore ? "Merged" : "Wrote"), fp);
}

async function scaffoldNewVault(vault, lang, dryRun) {
  await fse.ensureDir(path.join(vault, ".obsidian"));
  const start =
    lang === "en"
      ? `---
type: index
tags: [start]
---

# START_HERE

1. Read \`MEMORY.md\`.
2. Then \`PROJECTS/<your-repo>.md\` (match your workspace folder name).
3. Log decisions in \`SESSION_LOG.md\`.
`
      : `---
type: index
tags: [start]
---

# START_HERE

1. Lee \`MEMORY.md\`.
2. Luego \`PROJECTS/<tu-repo>.md\` (ajusta el nombre a tu carpeta de proyecto).
3. Cierra tareas en \`SESSION_LOG.md\`.
`;
  await fse.writeFile(path.join(vault, "START_HERE.md"), start, "utf8");
  await fse.writeFile(
    path.join(vault, "MEMORY.md"),
    lang === "en"
      ? "# Global memory\n\nSeparate **facts** vs **hypotheses** explicitly.\n"
      : "# Memoria global\n\nSepara **hechos** e **hipótesis** explícitamente.\n",
    "utf8"
  );
  await fse.writeFile(path.join(vault, "SESSION_LOG.md"), "# SESSION_LOG\n\n", "utf8");
  await fse.ensureDir(path.join(vault, "PROJECTS"));
  await fse.writeFile(path.join(vault, "PROJECTS", ".gitkeep"), "", "utf8");
  // Evolving-memory homes: STACKS/ (one note per tech) + PRACTICES/ (hypotheses → confirmed).
  await fse.ensureDir(path.join(vault, "STACKS"));
  await fse.writeFile(path.join(vault, "STACKS", ".gitkeep"), "", "utf8");
  await fse.ensureDir(path.join(vault, "PRACTICES"));
  const practices =
    lang === "en"
      ? {
          obs: "# Observations (hypotheses)\n\nOne line each: `date · file:line · pattern · status: pending|confirmed|dismissed`. Promote confirmed ones to `confirmed-bad.md`.\n",
          good: "# Confirmed good practices\n\nPatterns the user prefers — reinforce them when they apply.\n",
          bad: "# Confirmed anti-patterns\n\nPatterns the user rejected — flag (ask, don't impose) when they reappear.\n"
        }
      : {
          obs: "# Observaciones (hipótesis)\n\nUna línea cada una: `fecha · archivo:línea · patrón · status: pending|confirmed|dismissed`. Promueve las confirmadas a `confirmed-bad.md`.\n",
          good: "# Buenas prácticas confirmadas\n\nPatrones que el usuario prefiere — refuérzalos cuando apliquen.\n",
          bad: "# Anti-patrones confirmados\n\nPatrones que el usuario rechazó — avisa (pregunta, no impongas) si reaparecen.\n"
        };
  await fse.writeFile(path.join(vault, "PRACTICES", "observations.md"), practices.obs, "utf8");
  await fse.writeFile(path.join(vault, "PRACTICES", "confirmed-good.md"), practices.good, "utf8");
  await fse.writeFile(path.join(vault, "PRACTICES", "confirmed-bad.md"), practices.bad, "utf8");
  // Per-model adaptive layer: the rules point here; the agent reads only its own row.
  await fse.ensureDir(path.join(vault, "_meta"));
  const profilesDoc =
    lang === "en"
      ? `# Agent profiles (which model, and what it's good at)

This vault may be driven by different models, each with different strengths when deciding what to do.
On a non-trivial task, read **your** row, follow its tuning, and **append a one-line observation** when
a model clearly excelled or stumbled at a task type — over time this learns the best model per job.

> Starting defaults — general, and they evolve. Correct them with real observations below.

| Model | Decision-making strength | Lean on it for | Tune the memory |
| --- | --- | --- | --- |
| Claude Opus / Sonnet | Reliable instruction-following + tool use, structured multi-step | agentic refactors, careful reviews, self-critique | full self-check + coaching; long context OK but stay passage-first |
| Cursor Composer | Fast in-IDE multi-file edits | big mechanical edits across the codebase | action-first; lean on STACKS/ patterns; shorter deliberation |
| GPT (incl. reasoning models) | Planning + tool orchestration | decomposing fuzzy tasks, multi-tool flows | decompose explicitly; verify tool results before trusting them |
| DeepSeek (V3 / R1) | Deep, cheap code/math reasoning | hard logic / algorithm problems | afford a deeper self-check on tricky logic; keep notes terse |
| Gemini | Very large context, multimodal | long-document / many-file synthesis | may load more, but passage-first still wins on cost/latency |

## Observations (evolving — append one line each)

Format: \`date · model · task type · what worked / what to avoid\`

<!-- example -->

- 2026-01-15 · Composer · auth/security change · missed an RLS edge case → add a Claude self-check pass for security-sensitive work
`
      : `# Perfiles de agente (qué modelo, y en qué destaca)

Este vault lo pueden conducir distintos modelos, cada uno con fortalezas distintas al decidir qué hacer.
En una tarea no trivial, lee **tu** fila, sigue su ajuste y **añade una observación de una línea** cuando
un modelo destaque o falle claramente en un tipo de tarea — con el tiempo aprende el mejor modelo por trabajo.

> Defaults de partida — generales, y evolucionan. Corrígelos con observaciones reales abajo.

| Modelo | Fortaleza al decidir | Aprovéchalo para | Ajusta la memoria |
| --- | --- | --- | --- |
| Claude Opus / Sonnet | Sigue instrucciones + tool use fiable, multi-paso | refactors agénticos, revisiones, autocrítica | self-check completo + coaching; contexto largo OK pero passage-first |
| Cursor Composer | Edición multi-archivo rápida en el IDE | cambios mecánicos amplios | acción primero; apóyate en STACKS/; menos deliberación |
| GPT (incl. razonadores) | Planificación + orquestación de tools | descomponer tareas difusas, multi-tool | descompón explícito; verifica resultados de tools |
| DeepSeek (V3 / R1) | Razonamiento profundo de código/mates, barato | lógica / algoritmos difíciles | permite un self-check más profundo; notas concisas |
| Gemini | Contexto enorme, multimodal | síntesis de muchos archivos / docs largos | puede cargar más, pero passage-first sigue ganando en coste |

## Observaciones (evolutivo — una línea cada una)

Formato: \`fecha · modelo · tipo de tarea · qué funcionó / qué evitar\`

<!-- example -->

- 2026-01-15 · Composer · cambio auth/seguridad · se le escapó un caso RLS → añade un self-check de Claude para trabajo sensible a seguridad
`;
  await fse.writeFile(path.join(vault, "_meta", "agent-profiles.md"), profilesDoc, "utf8");
  await fse.writeFile(path.join(vault, ".gitignore"), ".obsidian-memory-rag/\n", "utf8");
  await writeVaultGitWorkspaceSettings(vault, dryRun);
}

/** Strip UTF-8 BOM so JSON.parse succeeds (common when mcp.json was saved from PowerShell). */
function stripLeadingUtf8Bom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Write JSON to `fp` atomically: stage at `<fp>.tmp.<pid>.<ts>`, fsync, rename.
 * Crash mid-write leaves the original `fp` intact rather than truncating it.
 * On Linux/macOS the final file is chmod 0o600 — `mcp.json` may carry env
 * blocks for other MCP servers (API tokens, etc.) that shouldn't be world-readable.
 * @param {string} fp - target path
 * @param {unknown} data - JSON-serializable payload
 */
async function atomicWriteJson(fp, data) {
  await fse.ensureDir(path.dirname(fp));
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}`;
  await fse.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  if (process.platform !== "win32") {
    try {
      await fse.chmod(tmp, 0o600);
    } catch {
      /* best-effort: not all filesystems support chmod */
    }
  }
  await fse.rename(tmp, fp);
}

/**
 * @param {string} home
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {{ withHybrid?: boolean, repoRoot?: string | null }} [hybridOpts]
 */
async function writeCursorMcp(home, vaultAbs, dryRun, hybridOpts = {}) {
  const dir = path.join(home, ".cursor");
  const fp = path.join(dir, "mcp.json");
  let parsed = {};
  /** @type {Buffer | null} */
  let priorBytes = null;
  if (await fse.pathExists(fp)) {
    priorBytes = await fse.readFile(fp);
    const text = stripLeadingUtf8Bom(priorBytes.toString("utf8"));
    try {
      parsed = JSON.parse(text);
    } catch {
      console.warn(
        pc.yellow("Invalid JSON in mcp.json; will back up the original before overwriting")
      );
    }
  }
  let merged = mergeBasicMemoryServer(parsed, vaultAbs);
  const { withHybrid = false, repoRoot = null, semantic = false, vec = false } = hybridOpts;
  if (withHybrid && repoRoot) {
    merged = mergeObsidianHybridServer(merged, vaultAbs, path.resolve(repoRoot), { semantic, vec });
  }
  if (dryRun) {
    console.log(pc.cyan("[dry-run] would write"), fp);
    console.log(JSON.stringify(merged, null, 2));
    return;
  }
  await fse.ensureDir(dir);
  // Always preserve the previous mcp.json before overwriting — agent-driven
  // installs that go wrong should be 1 `mv` away from recovery, not a re-run
  // of the IDE wizard. Backups are kept indefinitely; clean up manually.
  if (priorBytes) {
    const bak = `${fp}.bak.${Date.now()}`;
    await fse.writeFile(bak, priorBytes);
    if (process.platform !== "win32") {
      try {
        await fse.chmod(bak, 0o600);
      } catch {
        /* ignore */
      }
    }
    console.log(pc.dim("Backed up previous mcp.json to"), bak);
  }
  await atomicWriteJson(fp, merged);
  console.log(pc.green("Wrote"), fp);
}

/**
 * Install a gitleaks `pre-commit` hook in the vault repo so secrets caught at
 * commit time block both the user's interactive commits AND the obsidian-memoryd
 * daemon's auto-commits. Falls through with a warning if gitleaks is not on PATH
 * at commit time — does not hard-fail commits when the tool isn't installed.
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
 * Register the MCP servers in Claude Code via its CLI (`claude mcp add -s user`) —
 * Claude Code does not read an mcp.json file. Idempotent: removes any same-scope
 * entry first. Falls back to printing the command if `claude` isn't on PATH.
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {{ withHybrid?: boolean, repoRoot?: string|null, semantic?: boolean, vec?: boolean }} [hybridOpts]
 */
async function registerClaudeCodeMcp(vaultAbs, dryRun, hybridOpts = {}) {
  const { withHybrid = false, repoRoot = null, semantic = false, vec = false } = hybridOpts;
  /** @type {Array<[string, object]>} */
  const servers = [["basic-memory", basicMemoryServer(vaultAbs)]];
  if (withHybrid && repoRoot) {
    servers.push([
      "obsidian-memory-hybrid",
      hybridServer(vaultAbs, path.resolve(repoRoot), { semantic, vec })
    ]);
  }
  for (const [name, server] of servers) {
    const addArgv = claudeAddArgv(name, server);
    if (dryRun) {
      console.log(pc.cyan("[dry-run] claude"), addArgv.join(" "));
      continue;
    }
    try {
      await execa("claude", claudeRemoveArgv(name), { reject: false }); // ignore "not found"
      const r = await execa("claude", addArgv, { reject: false });
      if (r.exitCode === 0) console.log(pc.green("Claude Code MCP added:"), name);
      else {
        console.warn(pc.yellow(`claude mcp add ${name} exited ${r.exitCode}; run manually:`));
        console.log("  claude " + addArgv.join(" "));
      }
    } catch {
      console.warn(pc.yellow("`claude` CLI not found; run manually:"));
      console.log("  claude " + addArgv.join(" "));
    }
  }
}

/**
 * Register the MCP servers in Codex CLI via `codex mcp add` — Codex stores them
 * in `~/.codex/config.toml` and merges the TOML itself, so we shell out instead
 * of editing the file (same approach as Claude Code). Idempotent: removes any
 * same-name entry first. Falls back to printing the command AND a ready-to-paste
 * `config.toml` block if `codex` isn't on PATH.
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 * @param {{ withHybrid?: boolean, repoRoot?: string|null, semantic?: boolean, vec?: boolean }} [hybridOpts]
 */
async function registerCodexMcp(vaultAbs, dryRun, hybridOpts = {}) {
  const { withHybrid = false, repoRoot = null, semantic = false, vec = false } = hybridOpts;
  /** @type {Array<[string, object]>} */
  const servers = [["basic-memory", basicMemoryServer(vaultAbs)]];
  if (withHybrid && repoRoot) {
    servers.push([
      "obsidian-memory-hybrid",
      hybridServer(vaultAbs, path.resolve(repoRoot), { semantic, vec })
    ]);
  }
  for (const [name, server] of servers) {
    const addArgv = codexAddArgv(name, server);
    if (dryRun) {
      console.log(pc.cyan("[dry-run] codex"), addArgv.join(" "));
      continue;
    }
    try {
      await execa("codex", codexRemoveArgv(name), { reject: false }); // ignore "not found"
      const r = await execa("codex", addArgv, { reject: false });
      if (r.exitCode === 0) console.log(pc.green("Codex CLI MCP added:"), name);
      else {
        console.warn(pc.yellow(`codex mcp add ${name} exited ${r.exitCode}; add it manually:`));
        console.log("  codex " + addArgv.join(" "));
        console.log(
          pc.dim("  …or paste into ~/.codex/config.toml:\n" + codexTomlBlock(name, server))
        );
      }
    } catch {
      console.warn(pc.yellow("`codex` CLI not found; add it manually:"));
      console.log("  codex " + addArgv.join(" "));
      console.log(
        pc.dim("  …or paste into ~/.codex/config.toml:\n" + codexTomlBlock(name, server))
      );
    }
  }
}

/**
 * Install the Python RAG backend editable (`pip install -e <rag>[semantic]`) so
 * the hybrid MCP + index build work without a separate manual step. Best-effort:
 * prints the command if pip/python is missing or the install fails.
 * @param {string|null} repoRoot
 * @param {boolean} semantic
 * @param {boolean} dryRun
 * @param {boolean} [vec] - also install the `[vec]` extra (sqlite-vec; ADR-0025)
 */
async function maybeInstallBackend(repoRoot, semantic, dryRun, vec = false) {
  if (!repoRoot) return;
  const ragPkg = path.join(repoRoot, "packages", "obsidian-memory-rag");
  const extras = [semantic ? "semantic" : null, vec ? "vec" : null].filter(Boolean);
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
    if (dryRun) {
      console.log(pc.cyan("[dry-run] would create starter vault at"), vault);
    } else {
      await scaffoldNewVault(vault, lang, dryRun);
      createdVault = true;
    }
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
  const wantGitleaks = argv.includes("--with-gitleaks");
  const ides = idesFromArgs(argv, { full });
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
        kitRoot = null;
      } else {
        console.error(
          pc.red(
            "--with-hybrid: pass --repo-root <path-to-obsidian-memory-kit-clone> or run from that clone (cwd walk), and ensure the bridge + Python src exist."
          )
        );
        process.exit(2);
      }
    }
  }

  console.log(
    pc.cyan(t.title),
    pc.dim(full ? "full preset" : minimal ? "minimal" : "full stack (default)")
  );

  const mcpSnippet = {
    command: "uvx",
    args: ["basic-memory", "mcp"],
    env: { BASIC_MEMORY_HOME: vault }
  };

  const hybridOpts = {
    withHybrid: wantHybrid,
    repoRoot: kitRoot,
    semantic: wantSemantic,
    vec: wantVec
  };
  if (ides.includes("cursor") && !noCursorMcp) {
    await writeCursorMcp(home, vault, dryRun, hybridOpts);
  } else if (ides.includes("cursor") && noCursorMcp) {
    console.log(pc.dim("Skipped Cursor mcp.json (--no-cursor-mcp)"));
  }
  if (ides.includes("claude")) {
    await registerClaudeCodeMcp(vault, dryRun, hybridOpts);
  }
  if (ides.includes("codex")) {
    await registerCodexMcp(vault, dryRun, hybridOpts);
  }
  // Install the Python backend before building the index so the build can succeed
  // on a fresh machine in the same run.
  if (wantInstallBackend && kitRoot) {
    await maybeInstallBackend(kitRoot, wantSemantic, dryRun, wantVec);
  }
  if (wantBuildIndex) {
    await maybeBuildIndex(vault, dryRun, { repoRoot: kitRoot, semantic: wantSemantic });
  }

  // Rules ship by default too (part of "everything"); --no-rules / --minimal opt out.
  const ruleTargets = rulesTargetsFromArgs(argv, ides, { full: !minimal });
  if (ruleTargets.length) {
    await installRules(ruleTargets, lang, { home, cwd, dryRun });
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
    const extras = [wantSemantic ? "semantic" : null, wantVec ? "vec" : null].filter(Boolean);
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
  }
  if (ides.includes("claude")) {
    console.log(
      "- Claude Code: MCP registered via `claude mcp add -s user` (verify: `claude mcp list`)"
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
  if (argv.includes("--help")) {
    console.log(`Usage: create-obsidian-memory [vault] [options]

Examples:
  create-obsidian-memory                 # interactive wizard (pre-selects everything)
  create-obsidian-memory ./my-vault -y   # headless, FULL stack by default, into ./my-vault
  create-obsidian-memory -y              # headless, FULL stack, default vault path
  create-obsidian-memory -y --minimal    # headless, plain basic-memory only

The install is the FULL stack BY DEFAULT (hybrid + semantic + index + sqlite-vec +
rules); run it from a clone of the kit (or pass --repo-root) for the hybrid pieces —
it degrades to basic-memory (no abort) when no clone is found. Use --minimal for plain
basic-memory, or --no-<piece> to drop one part.

Interactive (default):
  --lang en       English prompts
  --dry-run       Show what would be written (no writes)

Feature set:
  --full, --all   Alias for the default full stack PLUS --ide codex,claude (implies -y).
                  Since the full stack is now the default, --full mainly flips the IDE
                  default to codex,claude. Opt out of a piece with --no-semantic /
                  --no-vec / --no-build-index / --no-install-backend / --no-rules.
  --minimal       Opposite of the default: install plain basic-memory only (no hybrid,
                  semantic, index, vec, or rules). Re-add one piece with --with-hybrid /
                  --semantic / --vec / --build-index / --install-backend / --rules.

Headless (CI / scripts) — add -y (aliases: --yes, --non-interactive):
  [vault]         Vault path as the first argument (or --vault <path>); defaults to
                  ~/Documents/obsidian-memory-vault and is created if it doesn't exist.
  --ide <list>    IDEs to wire, comma-separated: codex, claude, cursor (default: cursor;
                  with --full: codex,claude). codex uses the Codex CLI (codex mcp add →
                  ~/.codex/config.toml); claude uses the Claude Code CLI (claude mcp add
                  -s user); cursor writes ~/.cursor/mcp.json.
  --no-cursor-mcp Skip writing ~/.cursor/mcp.json
  --no-git-init   Skip git init when .git is missing
                  (Merges kit Git/SCM keys into <vault>/.vscode/settings.json — creates or updates.)
  --with-hybrid   Also wire obsidian-memory-hybrid (needs kit clone; use --repo-root or cwd walk)
  --repo-root <path>  Root of obsidian-memory-kit clone (hybrid bridge + Python src)
  --semantic      With --with-hybrid: neural embeddings (fastembed multilingual; needs the [semantic] extra)
  --vec           With --with-hybrid: sqlite-vec acceleration (needs the [vec] extra; sets
                  OBSIDIAN_MEMORY_SQLITE_VEC=1). Ranking-identical, safe fallback. On under --full.
  --build-index   After wiring, build the local FTS (+semantic) index (needs the Python backend)
  --install-backend  pip install -e the Python RAG backend (best-effort; on by default under --full)
  --with-gitleaks Install gitleaks pre-commit hook in <vault>/.git/hooks/
  --rules <list>  Install the memory-rules block into agent configs: claude
                  (~/.claude/CLAUDE.md, global), codex (~/.codex/AGENTS.md, global),
                  agents (./AGENTS.md), cursor (.cursor/rules/obsidian-memory.mdc).
                  Or 'all' / 'none'. Headless installs rules by DEFAULT (for each wired
                  agent); pass --no-rules or --minimal to skip, or --rules <list> to
                  choose. Interactive asks (deriving from --ide). Idempotent marked block
                  (obsidian-memory:start/end) — never clobbers content.
  --no-rules      Don't write any rules file.

  --help          This message`);
    return;
  }

  if (nonInteractiveFromArgs()) {
    await runNonInteractive(argv);
    return;
  }

  const lang = langFromArgs();
  const dryRun = dryRunFromArgs();
  const t = messages[lang];
  console.log(pc.cyan(t.title), pc.dim("v2 / v3"));
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

  const { age } = await prompts({
    type: "confirm",
    name: "age",
    message: t.age,
    initial: false
  });

  const { daemon } = await prompts({
    type: "confirm",
    name: "daemon",
    message: t.daemon,
    initial: process.platform !== "win32"
  });

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
          hybridOpts = {
            withHybrid: true,
            repoRoot: kitRoot,
            semantic: Boolean(semantic),
            vec: true
          };
        } else {
          console.warn(pc.yellow("Hybrid paths not found; skipping obsidian-memory-hybrid."));
        }
      }
    }
  }

  const mcpSnippet = {
    command: "uvx",
    args: ["basic-memory", "mcp"],
    env: { BASIC_MEMORY_HOME: vault }
  };

  if (ides?.includes("cursor")) {
    await writeCursorMcp(home, vault, dryRun, hybridOpts);
  }
  if (ides?.includes("claude")) {
    await registerClaudeCodeMcp(vault, dryRun, hybridOpts);
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
    await installRules(ruleTargets, lang, { home, cwd, dryRun });
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
  if (age) console.log("- age: document keys outside repo");
  if (daemon)
    console.log(
      "- obsidian-memoryd:",
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
