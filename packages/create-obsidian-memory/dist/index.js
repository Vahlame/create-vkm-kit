#!/usr/bin/env node
/**
 * @vahlame/create-obsidian-memory — interactive initializer (v2 beta).
 * Spanish-first CLI; pass --lang en for English labels.
 */
import path from "node:path";
import pc from "picocolors";
import prompts from "prompts";
import { execa } from "execa";
import fse from "fs-extra";
import { mergeBasicMemoryServer } from "./mcp-merge.mjs";

/** Cursor/VS Code workspace defaults: fewer `git` + `conhost` spikes on Windows (SCM polling). */
const VAULT_VSCODE_GIT_SETTINGS = {
  "git.autoRepositoryDetection": false,
  "git.autorefresh": false,
  "git.autofetch": false,
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
    "**/.git/lfs/**": true,
  },
};

const messages = {
  es: {
    title: "create-obsidian-memory",
    vaultQ: "Ruta del vault (debe contener .obsidian o crearemos uno)",
    createVault: "Crear ./obsidian-vault de ejemplo",
    ides: "IDEs a configurar (espacio para MCP)",
    gitleaks: "Activar hook pre-commit gitleaks",
    age: "Activar cifrado age para datos sensibles (mas friccion)",
    daemon: "Instalar obsidian-memoryd como servicio de usuario",
    summary: "Listo. Pasos siguientes",
    otherIdes: "Copia este bloque MCP en la config del IDE:",
    ftsHint:
      "Opcional (vaults grandes): obsidian-memory-rag index --vault <ruta> (FTS5 BM25; ver README del repo).",
  },
  en: {
    title: "create-obsidian-memory",
    vaultQ: "Vault path (must contain .obsidian or we create a sample)",
    createVault: "Create ./obsidian-vault sample",
    ides: "IDEs to wire for MCP",
    gitleaks: "Enable gitleaks pre-commit hook",
    age: "Enable age encryption (more friction)",
    daemon: "Install obsidian-memoryd user service",
    summary: "Done. Next steps",
    otherIdes: "Paste this MCP block into each IDE's config:",
    ftsHint:
      "Optional (large vaults): obsidian-memory-rag index --vault <path> (FTS5 BM25; see upstream README).",
  },
};

function langFromArgs() {
  const i = process.argv.indexOf("--lang");
  if (i >= 0 && process.argv[i + 1] === "en") return "en";
  return "es";
}

function dryRunFromArgs() {
  return process.argv.includes("--dry-run");
}

function nonInteractiveFromArgs() {
  return process.argv.includes("--non-interactive") || process.argv.includes("--yes");
}

/** @param {string[]} argv */
function flagValue(argv, name) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return null;
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
 * Writes `<vault>/.vscode/settings.json` once if missing (does not overwrite user edits).
 * @param {string} vault
 * @param {boolean} dryRun
 */
async function writeVaultGitWorkspaceSettings(vault, dryRun) {
  const fp = path.join(vault, ".vscode", "settings.json");
  if (await fse.pathExists(fp)) return;
  if (dryRun) {
    console.log(pc.cyan("[dry-run] would create"), fp);
    return;
  }
  await fse.ensureDir(path.dirname(fp));
  await fse.writeFile(fp, `${JSON.stringify(VAULT_VSCODE_GIT_SETTINGS, null, 2)}\n`, "utf8");
  console.log(pc.green("Wrote"), fp);
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
    "utf8",
  );
  await fse.writeFile(path.join(vault, "SESSION_LOG.md"), "# SESSION_LOG\n\n", "utf8");
  await fse.ensureDir(path.join(vault, "PROJECTS"));
  await fse.writeFile(path.join(vault, "PROJECTS", ".gitkeep"), "", "utf8");
  await fse.writeFile(path.join(vault, ".gitignore"), ".obsidian-memory-rag/\n", "utf8");
  await writeVaultGitWorkspaceSettings(vault, dryRun);
}

/**
 * @param {string} home
 * @param {string} vaultAbs
 * @param {boolean} dryRun
 */
/** Strip UTF-8 BOM so JSON.parse succeeds (common when mcp.json was saved from PowerShell). */
function stripLeadingUtf8Bom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function writeCursorMcp(home, vaultAbs, dryRun) {
  const dir = path.join(home, ".cursor");
  const fp = path.join(dir, "mcp.json");
  let parsed = {};
  if (await fse.pathExists(fp)) {
    try {
      const raw = stripLeadingUtf8Bom(await fse.readFile(fp, "utf8"));
      parsed = JSON.parse(raw);
    } catch {
      const bak = `${fp}.bak.${Date.now()}`;
      await fse.copy(fp, bak);
      console.warn(pc.yellow("Invalid JSON in mcp.json; backed up to"), bak);
    }
  }
  const merged = mergeBasicMemoryServer(parsed, vaultAbs);
  if (dryRun) {
    console.log(pc.cyan("[dry-run] would write"), fp);
    console.log(JSON.stringify(merged, null, 2));
    return;
  }
  await fse.ensureDir(dir);
  await fse.writeFile(fp, JSON.stringify(merged, null, 2), "utf8");
  console.log(pc.green("Wrote"), fp);
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
  const vaultRaw = flagValue(argv, "--vault");
  if (!vaultRaw) {
    console.error(pc.red("--vault <path> is required with --non-interactive"));
    process.exit(2);
  }
  const vault = path.resolve(cwd, vaultRaw);
  if (!(await fse.pathExists(vault))) {
    console.error(pc.red("Vault path does not exist:"), vault);
    process.exit(2);
  }
  const noCursorMcp = argv.includes("--no-cursor-mcp");
  const noGitInit = argv.includes("--no-git-init");

  console.log(pc.cyan(t.title), pc.dim("non-interactive"));

  const mcpSnippet = {
    command: "uvx",
    args: ["basic-memory", "mcp"],
    env: { BASIC_MEMORY_HOME: vault },
  };

  if (!noCursorMcp) {
    await writeCursorMcp(home, vault, dryRun);
  } else {
    console.log(pc.dim("Skipped Cursor mcp.json (--no-cursor-mcp)"));
  }

  if (!noGitInit && !(await fse.pathExists(path.join(vault, ".git")))) {
    await execa("git", ["init"], { cwd: vault, stdio: "inherit" });
  }

  await writeVaultGitWorkspaceSettings(vault, dryRun);

  console.log(pc.green("\n" + t.summary));
  console.log("- Vault:", vault);
  console.log("- MCP:", JSON.stringify(mcpSnippet));
  console.log("-", t.ftsHint);
}

async function main() {
  const argv = process.argv;
  if (argv.includes("--help")) {
    console.log(`Usage: create-obsidian-memory [options]

Interactive (default):
  --lang en       English prompts
  --dry-run       Show merged Cursor mcp.json only (no write)

Non-interactive (CI / scripts):
  --non-interactive | --yes
  --vault <path>  Absolute or cwd-relative vault root (required)
  --no-cursor-mcp Skip writing ~/.cursor/mcp.json
  --no-git-init   Skip git init when .git is missing
                  (Creates <vault>/.vscode/settings.json once if missing: calmer Git on Windows.)

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
  console.log(pc.cyan(t.title), pc.dim("v2 beta"));
  if (dryRun) console.log(pc.dim("dry-run: Cursor mcp.json will not be written"));

  const cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || cwd;
  let vault = await findVault(cwd, home);

  if (!vault) {
    const { ok } = await prompts({
      type: "confirm",
      name: "ok",
      message: t.createVault,
      initial: true,
    });
    if (ok) {
      vault = path.join(cwd, "obsidian-vault");
      await scaffoldNewVault(vault, lang, dryRun);
    } else {
      const { p } = await prompts({
        type: "text",
        name: "p",
        message: t.vaultQ,
        initial: cwd,
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
      { title: "Cursor", value: "cursor", selected: true },
      { title: "VS Code / Cline", value: "cline", selected: false },
      { title: "Windsurf", value: "windsurf", selected: false },
      { title: "Zed", value: "zed", selected: false },
    ],
  });

  const { gitleaks } = await prompts({
    type: "confirm",
    name: "gitleaks",
    message: t.gitleaks,
    initial: true,
  });

  const { age } = await prompts({
    type: "confirm",
    name: "age",
    message: t.age,
    initial: false,
  });

  const { daemon } = await prompts({
    type: "confirm",
    name: "daemon",
    message: t.daemon,
    initial: process.platform !== "win32",
  });

  const mcpSnippet = {
    command: "uvx",
    args: ["basic-memory", "mcp"],
    env: { BASIC_MEMORY_HOME: vault },
  };

  if (ides?.includes("cursor")) {
    await writeCursorMcp(home, vault, dryRun);
  }

  const others = (ides || []).filter((x) => x !== "cursor");
  if (others.length) {
    console.log(pc.yellow(t.otherIdes), others.join(", "));
    console.log(JSON.stringify({ mcpServers: { "basic-memory": mcpSnippet } }, null, 2));
  }

  if (!(await fse.pathExists(path.join(vault, ".git")))) {
    await execa("git", ["init"], { cwd: vault, stdio: "inherit" });
  }

  await writeVaultGitWorkspaceSettings(vault, dryRun);

  console.log(pc.green("\n" + t.summary));
  console.log("- Vault:", vault);
  console.log("- MCP:", JSON.stringify(mcpSnippet));
  console.log("-", t.ftsHint);
  if (gitleaks) console.log("- gitleaks: install CLI + hook (see CONTRIBUTING / CI secrets-scan)");
  if (age) console.log("- age: document keys outside repo");
  if (daemon) console.log("- obsidian-memoryd:", "`obsidian-memoryd service install --user && obsidian-memoryd service start`");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
