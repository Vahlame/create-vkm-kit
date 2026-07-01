#!/usr/bin/env node
/**
 * obsidian-prompt — compiles a vault-aware <orchestration_package> XML prompt from a
 * one-line idea, for pasting into an AI tool that does NOT have the vault's MCP wired
 * (a web chat, another editor's chat panel, etc.). If your target already has
 * vault_hybrid_search available (Claude Code/Codex/Cursor with this kit installed), it
 * can fetch context itself, on demand and cheaper — this tool is for the cases where it
 * can't. No LLM call: context comes straight from vault_observations/vault_hybrid_search
 * via the same Python bridge as the obsidian-memory-hybrid MCP server.
 *
 * Modules: project-resolve (capture), context-search (retrieval), compile-xml
 * (compiler), clipboard/review (output).
 */
import { pathToFileURL } from "node:url";
import pc from "picocolors";
import prompts from "prompts";
import { requireVault } from "@vkmikc/obsidian-memory-mcp/src/rag-client.mjs";
import { resolveProject } from "./project-resolve.mjs";
import { searchContext } from "./context-search.mjs";
import { compileOrchestrationPackage } from "./compile-xml.mjs";
import { copyToClipboard } from "./clipboard.mjs";
import { editorCommand, reviewInEditor } from "./review.mjs";
import { defaultSystemRole, thinContextNote, backendErrorNote } from "./prompt-defaults.mjs";

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function splitList(value) {
  return value
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
}

function printHelp() {
  console.log(`Usage: obsidian-prompt "<idea>" [options]

Compiles a vault-aware <orchestration_package> XML prompt and copies it to the clipboard.

Options:
  --project <name>      Project to pull context from (PROJECTS/<name>.md). Omit to pick
                         interactively from what exists in the vault.
  --vault <path>        Vault root. Defaults to BASIC_MEMORY_HOME / OBSIDIAN_MEMORY_VAULT.
  --lang es|en           Output language for the compiled prompt (default: es).
  --files <a,b,c>        Comma-separated paths to list under <active_files>.
  --requirements <a,b,c> Comma-separated functional requirements (numbered in the output).
  --constraints <a,b,c>  Comma-separated constraints (under <guardrails>).
  --format <text>        Hint for the expected output shape (<format> tag).
  --no-editor            Skip opening $VISUAL/$EDITOR for review before copying.
  --no-clipboard         Print the compiled XML instead of copying it.
  -y, --yes              Skip confirmation prompts (implies non-interactive project pick).
  --help                 This message.
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.length === 0) {
    printHelp();
    return;
  }

  // The idea is the first token that isn't a flag and isn't a flag's value.
  const positional = [];
  const flagNames = new Set([
    "--project",
    "--vault",
    "--lang",
    "--files",
    "--requirements",
    "--constraints",
    "--format"
  ]);
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
    console.error(pc.red('Falta la idea: obsidian-prompt "qué querés construir"'));
    process.exitCode = 1;
    return;
  }

  const yes = argv.includes("--yes") || argv.includes("-y");
  const lang = flagValue(argv, "--lang") === "en" ? "en" : "es";
  const noEditor = argv.includes("--no-editor");
  const noClipboard = argv.includes("--no-clipboard");

  let vault;
  try {
    vault = requireVault(flagValue(argv, "--vault"));
  } catch (e) {
    console.error(pc.red(e.message));
    process.exitCode = 1;
    return;
  }

  const { projectName, projectNote } = await resolveProject({
    vault,
    projectFlag: flagValue(argv, "--project"),
    nonInteractive: yes
  });

  const context = await searchContext({ vault, query: ideaText, projectNote, projectName });

  if (context.backendError) {
    console.error(pc.red(`[!] Vault search backend failed: ${context.backendError}`));
    console.error(
      pc.dim(
        lang === "en"
          ? "The package below has no vault context because of this — fix the backend first."
          : "El paquete de abajo no tiene contexto del vault por esto — arreglá el backend primero."
      )
    );
  }

  let currentState = context.currentState || undefined;
  if (context.usedFallback && !context.backendError && !yes) {
    const { extra } = await prompts({
      type: "text",
      name: "extra",
      message:
        lang === "en"
          ? "No prior info found for this. Add context in your own words? (Enter to skip)"
          : "No encontré info previa de esto. ¿Agregás contexto en tus palabras? (Enter para saltar)"
    });
    currentState = extra && extra.trim() ? extra.trim() : undefined;
  }

  const xml = compileOrchestrationPackage({
    lang,
    systemRole: defaultSystemRole(lang, projectName),
    techStack: context.techStack,
    activeFiles: splitList(flagValue(argv, "--files")),
    currentState,
    historicalDecisions: context.historicalDecisions,
    activePatterns: context.activePatterns,
    userIntent: ideaText,
    functionalRequirements: splitList(flagValue(argv, "--requirements")),
    constraints: splitList(flagValue(argv, "--constraints")),
    format: flagValue(argv, "--format"),
    note: context.backendError
      ? backendErrorNote(lang, context.backendError)
      : context.usedFallback
        ? thinContextNote(lang)
        : undefined
  });

  console.log(pc.dim(`Proyecto: ${projectName || "(ninguno)"} · vault: ${vault}`));
  console.log(xml);

  let finalText = xml;
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
    if (openIt) finalText = reviewInEditor(xml);
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
    pc.green("Copiado al portapapeles."),
    pc.dim(`${finalText.length} caracteres (~${approxTokens} tokens estimados).`)
  );
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((e) => {
    console.error(pc.red(e?.message || e));
    process.exitCode = 1;
  });
}
