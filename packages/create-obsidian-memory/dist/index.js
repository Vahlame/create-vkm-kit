#!/usr/bin/env node
/**
 * @vahlame/create-obsidian-memory — interactive initializer (v2 beta).
 * Spanish-first CLI; pass --lang en for English labels.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import prompts from "prompts";
import { execa } from "execa";
import fse from "fs-extra";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  },
};

function langFromArgs() {
  const i = process.argv.indexOf("--lang");
  if (i >= 0 && process.argv[i + 1] === "en") return "en";
  return "es";
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

async function main() {
  const lang = langFromArgs();
  const t = messages[lang];
  console.log(pc.cyan(t.title), pc.dim("v2 beta"));

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
      await fse.ensureDir(path.join(vault, ".obsidian"));
      await fse.writeFile(path.join(vault, "START_HERE.md"), "# Vault\n\nEmpieza aqui.\n", "utf8");
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
    const p = path.join(home, ".cursor", "mcp.json");
    console.log(pc.yellow("Cursor:"), "merge into", p, JSON.stringify({ mcpServers: { "basic-memory": mcpSnippet } }, null, 2));
  }

  if (!(await fse.pathExists(path.join(vault, ".git")))) {
    await execa("git", ["init"], { cwd: vault, stdio: "inherit" });
  }

  console.log(pc.green("\n" + t.summary));
  console.log("- Vault:", vault);
  console.log("- MCP:", JSON.stringify(mcpSnippet));
  if (gitleaks) console.log("- gitleaks: run `brew install gitleaks` / see docs (hook template pending)");
  if (age) console.log("- age: document keys outside repo");
  if (daemon) console.log("- obsidian-memoryd:", "`obsidian-memoryd service install --user && obsidian-memoryd service start`");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
