#!/usr/bin/env node
/**
 * Claude Code `SessionStart` hook — injects the vault map + the "vault is the only
 * source of truth" reminders as `additionalContext`, so every session starts knowing
 * the native auto-memory is OFF and recall/close go through the Obsidian vault.
 *
 * Installed by create-obsidian-memory — the vkm-kit installer — into `~/.claude/hooks/` and
 * registered in `~/.claude/settings.json` as: `node "<this file>" "<vault>" [lang]`.
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
import os from "node:os";
import path from "node:path";

/** Vault path: 1st CLI arg wins, else the MCP env vars the kit sets. */
function resolveVault() {
  const fromArg = process.argv[2];
  if (fromArg && fromArg.trim()) return fromArg.trim();
  return (
    process.env.VKM_VAULT ||
    process.env.BASIC_MEMORY_HOME ||
    process.env.OBSIDIAN_MEMORY_VAULT ||
    ""
  );
}

function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Backstop cap on the curated index dump injected into EVERY session. A
 * hand-maintained index that gains one entry per project only grows over time — left
 * uncapped, this hook's fixed per-session token tax grows right along with the vault
 * (~10KB / ~2500 tokens on a modest 69-note vault). Compression (below) runs first;
 * this cap only bites on unusually large or unusually prosy indices. */
export const MAX_INDEX_CHARS = 3000;

/** Per-entry cap for compressIndex: enough for "name — one-line purpose", not for
 * the whole multi-sentence history an index entry tends to accrete. */
export const MAX_ENTRY_CHARS = 100;

/**
 * Compress the curated index instead of blindly truncating it (ADR-0035). The old
 * hard cut kept the first N chars — full prose for early entries, and any project
 * past the cap silently invisible to the session. For a *pointer map* that's
 * backwards: every entry's NAME is worth more than any entry's third sentence.
 * So: keep headings and structure, cap each list item at MAX_ENTRY_CHARS (cut at a
 * word boundary, '…'), drop YAML frontmatter and collapse blank runs. Result: all
 * pointers visible, prose available on demand via vault_read_file/search.
 */
export function compressIndex(index) {
  const lines = index.split(/\r?\n/);
  let i = 0;
  // Drop a leading YAML frontmatter block (--- … ---): metadata, not pointers.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === "---");
    if (end > 0) i = end + 1;
  }
  const out = [];
  let blank = false;
  for (; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) {
      if (!blank && out.length) out.push("");
      blank = true;
      continue;
    }
    const isHeading = line.startsWith("#");
    const isBullet = line.trimStart().startsWith("- ");
    let kept = line;
    if (!isHeading && line.trim().length > MAX_ENTRY_CHARS) {
      if (!isBullet) continue; // over-cap prose (incl. bullet overflow wraps): a
      // mid-sentence fragment reads worse than absence — the full text is one
      // vault_read_file away. Bullets ARE the pointers, so those get capped instead:
      const slice = line.slice(0, MAX_ENTRY_CHARS);
      const cutAt = slice.lastIndexOf(" ");
      kept = slice.slice(0, cutAt > MAX_ENTRY_CHARS / 2 ? cutAt : MAX_ENTRY_CHARS) + "…";
    }
    blank = false;
    out.push(kept);
  }
  // A dropped prose block can leave a dangling blank at the tail.
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join("\n").trim();
}

export function truncateIndex(index, lang) {
  const compressed = compressIndex(index);
  if (compressed.length <= MAX_INDEX_CHARS) return compressed;
  const notice =
    lang === "en"
      ? `\n\n[...truncated: index is ${compressed.length} chars compressed, showing the first ${MAX_INDEX_CHARS}. Use vault_read_file("_meta/index.md") for the rest.]`
      : `\n\n[...truncado: el indice comprimido tiene ${compressed.length} caracteres, mostrando los primeros ${MAX_INDEX_CHARS}. Usa vault_read_file("_meta/index.md") para el resto.]`;
  return compressed.slice(0, MAX_INDEX_CHARS) + notice;
}

/**
 * The reinforced precedence reminders. Compact on purpose (ADR-0082): the full protocol
 * already rides in the managed rules block that every wired session loads; this restates
 * only the HARD RULE plus the four operational one-liners, at less than half the tokens
 * the pre-diet version charged every single session.
 */
export function reminders(lang) {
  if (lang === "en") {
    return [
      "---",
      "MEMORY (HARD RULE): the Obsidian vault is the ONLY source of truth; Claude Code's native auto-memory (~/.claude/projects/*/memory/) is DISABLED (autoMemoryEnabled:false) or a READ-ONLY MIRROR — never write the close ritual there.",
      "- vault_* tools deferred? Load them with ToolSearch (select:vault_hybrid_search,vault_read_file,vault_edit_file,vault_write_file) before touching memory; never the native Write for memory.",
      '- Non-trivial task: BEFORE answering, vault_hybrid_search("<topic>") and answer from the returned section (passage-first). First task of the session -> START_HERE.md + MEMORY.md.',
      '- CLOSE: SESSION_LOG.md (1 line) + PROJECTS/<project>.md (above "## Related"); anchor each vault_edit_file on ONE line (CRLF); don\'t commit (the daemon syncs).'
    ].join("\n");
  }
  return [
    "---",
    "MEMORIA (REGLA DURA): el vault Obsidian es la UNICA fuente de verdad; la auto-memoria nativa (~/.claude/projects/*/memory/) esta DESACTIVADA (autoMemoryEnabled:false) o es ESPEJO READ-ONLY — nunca escribas el cierre ahi.",
    "- Tools vault_* deferred? Cargalas con ToolSearch (select:vault_hybrid_search,vault_read_file,vault_edit_file,vault_write_file) antes de tocar memoria; nunca el Write nativo para memoria.",
    '- Tarea no trivial: ANTES de responder, vault_hybrid_search("<tema>") y responde con la seccion devuelta (passage-first). Primera tarea de la sesion -> START_HERE.md + MEMORY.md.',
    '- CIERRE: SESSION_LOG.md (1 linea) + PROJECTS/<proyecto>.md (arriba de "## Relacionado"); ancla cada vault_edit_file en UNA linea (CRLF); no commitees (el daemon sincroniza).'
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
        // A pathological index (all over-cap prose, no pointers) compresses to "" —
        // emit nothing rather than an empty labelled section.
        if (index) {
          parts.push(
            lang === "en" ? "Curated index (_meta/index.md):" : "Indice curado (_meta/index.md):",
            "",
            index,
            ""
          );
        }
      }
    } catch {
      /* index unreadable — still emit the reminders below */
    }
  }

  parts.push(reminders(lang));
  return parts.join("\n");
}

/**
 * Record what only a `SessionStart` hook can see: the model this session started on.
 *
 * Claude Code exposes the model on this event alone ("not guaranteed to be present"), and
 * there is no `$CLAUDE_MODEL` — so the effort gate, a `PreToolUse` hook, has no other way
 * to know whether it is looking at opus, sonnet or a deliberate `fable` session. It reads
 * the sidecar this writes (`~/.vkm/effort-gate/<session_id>.json`).
 *
 * Best-effort in every direction: no payload, no model field, or an unwritable directory
 * all end with the gate simply not naming a model. It must never delay a session start.
 *
 * @param {object} input the hook's stdin payload
 * @param {string} [home]
 */
export function recordSessionModel(input, home = os.homedir()) {
  try {
    const sessionId = String(input?.session_id ?? "").trim();
    const model = input?.model;
    if (!sessionId || !model) return null;
    const dir = path.join(home, ".vkm", "effort-gate");
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, `${sessionId.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
    let prior = {};
    try {
      prior = JSON.parse(fs.readFileSync(fp, "utf8")) || {};
    } catch {
      /* first write of this session */
    }
    fs.writeFileSync(fp, JSON.stringify({ ...prior, model }), "utf8");
    pruneSessionSidecars(dir);
    return fp;
  } catch {
    return null; // a session must start whether or not this works
  }
}

/** Drop sidecars older than a week: one small file per session adds up over months. */
function pruneSessionSidecars(dir, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const cutoff = Date.now() - maxAgeMs;
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) fs.rmSync(fp, { force: true });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* pruning is housekeeping, never a failure */
  }
}

export function main() {
  const vault = resolveVault();
  const lang = (process.argv[3] || "es").toLowerCase() === "en" ? "en" : "es";
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (raw.trim()) recordSessionModel(JSON.parse(raw));
  } catch {
    /* no payload on stdin (or unparseable) — the gate falls back to effort-only */
  }
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
