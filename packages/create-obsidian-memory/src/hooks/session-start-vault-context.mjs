#!/usr/bin/env node
/**
 * Claude Code `SessionStart` hook — injects the vault map + the "vault is the only
 * source of truth" reminders as `additionalContext`, so every session starts knowing
 * the native auto-memory is OFF and recall/close go through the Obsidian vault.
 *
 * Installed by `create-obsidian-memory` into `~/.claude/hooks/` and registered in
 * `~/.claude/settings.json` as: `node "<this file>" "<vault>" [lang]`.
 *
 * Cross-platform on purpose (Node, not PowerShell/bash) so ONE script — and ONE copy
 * of the reminder text — serves Windows, macOS and Linux.
 *
 * Contract (Claude Code hooks):
 *  - Print a single JSON object to stdout.
 *  - To inject text into the session context, emit:
 *      { "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<text>" } }
 *  - A non-zero exit is logged but does NOT abort the session. We never throw: a broken
 *    vault path must not block the user, so on any error we still emit the reminders.
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

/** Vault path: 1st CLI arg wins, else the MCP env vars the kit sets. */
function resolveVault() {
  const fromArg = process.argv[2];
  if (fromArg && fromArg.trim()) return fromArg.trim();
  return process.env.BASIC_MEMORY_HOME || process.env.OBSIDIAN_MEMORY_VAULT || "";
}

function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Cap on the curated index dump injected into EVERY session, unconditionally. A
 * hand-maintained index that gains one entry per project only grows over time — left
 * uncapped, this hook's fixed per-session token tax grows right along with the vault
 * (already ~10KB / ~2500 tokens on a modest 69-note vault). Generous enough to show the
 * section headers and the first several entries, not the whole thing. */
export const MAX_INDEX_CHARS = 4000;

export function truncateIndex(index, lang) {
  if (index.length <= MAX_INDEX_CHARS) return index;
  const notice =
    lang === "en"
      ? `\n\n[...truncated: index is ${index.length} chars, showing the first ${MAX_INDEX_CHARS}. Use vault_read_file("_meta/index.md") for the rest.]`
      : `\n\n[...truncado: el indice tiene ${index.length} caracteres, mostrando los primeros ${MAX_INDEX_CHARS}. Usa vault_read_file("_meta/index.md") para el resto.]`;
  return index.slice(0, MAX_INDEX_CHARS) + notice;
}

/** The reinforced precedence reminders. Kept in sync with the CLAUDE.md rules block. */
export function reminders(lang) {
  if (lang === "en") {
    return [
      "---",
      "MEMORY — precedence (HARD RULE): the Obsidian vault is the ONLY source of truth. Claude Code's NATIVE auto-memory (~/.claude/projects/*/memory/, the system prompt's \"# Memory\" section) is DISABLED by the installer (autoMemoryEnabled:false) / is a READ-ONLY MIRROR: do NOT write the close ritual there, redirect to the vault.",
      "- FIRST STEP if the vault_* tools appear as deferred (common with many MCP servers connected): load them with ToolSearch (select:vault_hybrid_search,vault_read_file,vault_edit_file,vault_write_file) BEFORE touching memory. The native Write tool is zero-friction and tempting; resist it.",
      '- For ANY non-trivial task (or when a project/person/decision/tool is named): BEFORE answering call mcp__obsidian-memory-hybrid__vault_hybrid_search("<topic>") and answer from the returned section (passage-first, cheap). Use read_text_file/vault_read_file only if you need the whole file.',
      "- If it's the first task of the session, start with START_HERE.md and MEMORY.md.",
      '- CLOSE (reusable task done): write to the vault with vault_edit_file/vault_write_file -> SESSION_LOG.md (1 line at the end) + PROJECTS/<project>.md (incremental, above "## Related") + STACKS/PRACTICES if it applies. Anchor each vault_edit_file on ONE single line (notes are CRLF). Don\'t commit: the obsidian-memoryd daemon syncs.'
    ].join("\n");
  }
  return [
    "---",
    'MEMORIA — precedencia (REGLA DURA): el vault Obsidian es la UNICA fuente de verdad. La auto-memoria nativa de Claude Code (~/.claude/projects/*/memory/, la seccion "# Memory" del system prompt) esta DESACTIVADA por el instalador (autoMemoryEnabled:false) / es ESPEJO READ-ONLY: NO escribas el cierre ahi, redirigi al vault.',
    "- PRIMER PASO si las tools vault_* aparecen como deferred (frecuente con muchos MCP conectados): cargalas con ToolSearch (select:vault_hybrid_search,vault_read_file,vault_edit_file,vault_write_file) ANTES de tocar memoria. El Write nativo es cero-friccion y tienta; resistilo.",
    '- Para CUALQUIER tarea no trivial (o si mencionas un proyecto/persona/decision/herramienta): ANTES de responder llama mcp__obsidian-memory-hybrid__vault_hybrid_search("<tema>") y responde con la seccion que devuelve (passage-first, barato). Usa read_text_file/vault_read_file solo si necesitas el archivo entero.',
    "- Si es la primera tarea de la sesion, empieza por START_HERE.md y MEMORY.md.",
    '- CIERRE (tarea reusable terminada): escribi al vault con vault_edit_file/vault_write_file -> SESSION_LOG.md (1 linea al final) + PROJECTS/<proyecto>.md (incremental, arriba de "## Relacionado") + STACKS/PRACTICES si aplica. Ancla cada vault_edit_file en UNA sola linea (notas en CRLF). No commitees: el daemon obsidian-memoryd sincroniza.'
  ].join("\n");
}

export function buildContext(vault, lang) {
  const header =
    lang === "en"
      ? "## Obsidian vault available (MCP memory)"
      : "## Vault Obsidian disponible (memoria MCP)";
  const parts = [header, ""];
  if (vault) parts.push(`Path: ${vault}`, "");

  // Top-level folder listing — so the agent knows the structure even if the index is stale.
  if (vault) {
    try {
      const entries = fs
        .readdirSync(vault, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !/^(\.git|\.obsidian)$/.test(e.name))
        .map((e) => `- ${e.name}/`);
      if (entries.length) {
        parts.push(
          lang === "en" ? "Top-level folders:" : "Carpetas top-level:",
          entries.join("\n"),
          ""
        );
      }
    } catch {
      /* vault unreadable — still emit the reminders below */
    }

    // Curated index (_meta/index.md), if present — capped (see truncateIndex).
    try {
      const indexPath = path.join(vault, "_meta", "index.md");
      if (fs.existsSync(indexPath)) {
        const index = truncateIndex(stripBom(fs.readFileSync(indexPath, "utf8")), lang);
        parts.push(
          lang === "en" ? "Curated index (_meta/index.md):" : "Indice curado (_meta/index.md):",
          "",
          index,
          ""
        );
      }
    } catch {
      /* index unreadable — still emit the reminders below */
    }
  }

  parts.push(reminders(lang));
  return parts.join("\n");
}

export function main() {
  const vault = resolveVault();
  const lang = (process.argv[3] || "es").toLowerCase() === "en" ? "en" : "es";
  let additionalContext;
  try {
    additionalContext = buildContext(vault, lang);
  } catch {
    additionalContext = reminders(lang); // last-resort: never block the session
  }
  const payload = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext
    }
  };
  process.stdout.write(JSON.stringify(payload));
}

// Guard so importing this module (e.g. from a test) does not also run main() as a
// side effect — mirrors the pattern in hybrid-mcp.mjs / the other managed hooks.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) main();
