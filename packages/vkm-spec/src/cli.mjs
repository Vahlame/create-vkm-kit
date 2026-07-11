#!/usr/bin/env node
/**
 * vkm-spec — turns a one-line idea into a vault-aware <orchestration_package> XML prompt,
 * ready to paste into Claude Code / Claude web / ChatGPT. Pulls context from the vault via
 * the shared `assembleContext` engine and, by default, asks a local Ollama (phi4-mini) to
 * draft the richer spec fields — falling back to a deterministic spec (source:"fallback")
 * whenever Ollama is absent, so the command ALWAYS produces a working prompt.
 *
 * Modules: project-resolve (capture), pipeline (assemble + optional draft + compile),
 * review/clipboard (output). Mirrors the donor obsidian-prompt CLI flow.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import path from "node:path";
import pc from "picocolors";
import prompts from "prompts";
import { requireVault } from "@vkmikc/obsidian-memory-mcp/src/rag-client.mjs";
import { resolveProject } from "./project-resolve.mjs";
import { buildSpec } from "./pipeline.mjs";
import { copyToClipboard } from "./clipboard.mjs";
import { editorCommand, reviewInEditor } from "./review.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function printHelp() {
  console.log(`Usage: vkm-spec "<idea>" [options]

Compiles a vault-aware <orchestration_package> XML prompt (optionally drafted by a local
Ollama phi4-mini) and copies it to the clipboard.

Options:
  --project <name>     Project to pull context from (PROJECTS/<name>.md). Omit to pick
                        interactively from what exists in the vault.
  --vault <path>       Vault root. Defaults to BASIC_MEMORY_HOME / OBSIDIAN_MEMORY_VAULT.
  --lang es|en          Output language for the compiled prompt (default: es).
  --no-llm             Skip the Ollama draft pass; deterministic spec only.
  --ollama-host <url>  Ollama base URL (default http://127.0.0.1:11434).
  --gui                Start the local GUI server and open the browser instead of the CLI.
  --no-editor          Skip opening $VISUAL/$EDITOR for review before copying.
  --no-clipboard       Print the compiled XML instead of copying it.
  -y, --yes            Skip confirmation prompts (implies non-interactive project pick).
  --help               This message.
`);
}

/** `--gui`: hand off to server.mjs as a child process so it keeps ALL its niceties
 * (EADDRINUSE reuse, browser open, hidden-window shortcut) without duplicating them here. */
function startGui(argv) {
  const serverScript = path.join(__dirname, "server.mjs");
  const pass = [];
  for (const name of ["--vault", "--lang", "--ollama-host", "--port"]) {
    const v = flagValue(argv, name);
    if (v !== undefined) pass.push(name, v);
  }
  const child = spawn(process.execPath, [serverScript, ...pass], { stdio: "inherit" });
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.length === 0) {
    printHelp();
    return;
  }

  if (argv.includes("--gui")) {
    startGui(argv);
    return;
  }

  // The idea is the first token that isn't a flag and isn't a flag's value.
  const flagNames = new Set(["--project", "--vault", "--lang", "--ollama-host", "--port"]);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (flagNames.has(tok)) {
      i++; // skip its value
      continue;
    }
    if (tok.startsWith("-")) continue;
    positional.push(tok);
  }
  const ideaText = positional[0];
  if (!ideaText) {
    console.error(pc.red('Falta la idea: vkm-spec "qué querés construir"'));
    process.exitCode = 1;
    return;
  }

  const yes = argv.includes("--yes") || argv.includes("-y");
  const lang = flagValue(argv, "--lang") === "en" ? "en" : "es";
  const llm = !argv.includes("--no-llm");
  const noEditor = argv.includes("--no-editor");
  const noClipboard = argv.includes("--no-clipboard");
  const ollamaHost = flagValue(argv, "--ollama-host");

  let vault;
  try {
    vault = requireVault(flagValue(argv, "--vault"));
  } catch (e) {
    console.error(pc.red(e.message));
    process.exitCode = 1;
    return;
  }

  const { projectName } = await resolveProject({
    vault,
    projectFlag: flagValue(argv, "--project"),
    nonInteractive: yes
  });

  // Live token counter while Ollama drafts (stderr, single line — keeps stdout clean for xml).
  let progressActive = false;
  const onProgress = llm
    ? (tokens) => {
        progressActive = true;
        process.stderr.write(`\r${pc.dim(`Ollama draft… ${tokens} chunks`)}`);
      }
    : undefined;

  const result = await buildSpec({
    idea: ideaText,
    project: projectName,
    vault,
    lang,
    llm,
    ollamaHost,
    onProgress
  });
  if (progressActive) process.stderr.write("\n");

  if (result.backendError) {
    console.error(pc.red(`[!] Vault search backend failed: ${result.backendError}`));
    console.error(
      pc.dim(
        lang === "en"
          ? "The package below has no vault context because of this — fix the backend first."
          : "El paquete de abajo no tiene contexto del vault por esto — arreglá el backend primero."
      )
    );
  }
  if (llm && result.source === "fallback") {
    console.error(
      pc.yellow(
        lang === "en"
          ? `[i] Ollama unavailable (${result.ollamaError || "unknown"}) — used the deterministic fallback spec.`
          : `[i] Ollama no disponible (${result.ollamaError || "desconocido"}) — usé el spec determinístico de respaldo.`
      )
    );
  }

  const badge = result.source === "ollama" ? pc.green("ollama") : pc.yellow("fallback");
  console.log(
    pc.dim(`Proyecto: ${projectName || "(ninguno)"} · vault: ${vault} · fuente: `) + badge
  );
  console.log(result.xml);

  let finalText = result.xml;
  if (!noEditor && !yes && editorCommand()) {
    const { openIt } = await prompts({
      type: "confirm",
      name: "openIt",
      message:
        lang === "en"
          ? `Open in ${editorCommand()} to review/edit?`
          : `¿Abrir en ${editorCommand()} para revisar/corregir?`,
      initial: true
    });
    if (openIt) finalText = reviewInEditor(result.xml);
  }

  if (noClipboard) {
    console.log(pc.dim("--no-clipboard: no se copió, solo se imprimió arriba."));
    return;
  }

  if (!yes) {
    const { doCopy } = await prompts({
      type: "confirm",
      name: "doCopy",
      message: lang === "en" ? "Copy to clipboard?" : "¿Copiar al portapapeles?",
      initial: true
    });
    if (!doCopy) return;
  }

  await copyToClipboard(finalText);
  const approxTokens = Math.round(finalText.length / 4);
  console.log(
    pc.green(lang === "en" ? "Copied to clipboard." : "Copiado al portapapeles."),
    pc.dim(
      lang === "en"
        ? `${finalText.length} chars (~${approxTokens} tokens estimated).`
        : `${finalText.length} caracteres (~${approxTokens} tokens estimados).`
    )
  );
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((e) => {
    console.error(pc.red(e?.message || e));
    process.exitCode = 1;
  });
}
