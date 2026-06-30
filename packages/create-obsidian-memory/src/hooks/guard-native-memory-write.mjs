#!/usr/bin/env node
/**
 * Claude Code `PreToolUse` hook — deterministically DENIES Write/Edit/MultiEdit/
 * NotebookEdit calls that target Claude's native per-project auto-memory directory
 * (`~/.claude/projects/<encoded-cwd>/memory/`), redirecting the model to the vault tools.
 *
 * Why a hook and not just another CLAUDE.md sentence: ADR-0029 already disables the
 * native auto-memory at the config level (`autoMemoryEnabled:false`) because relying on
 * the model to *honor a rule* against an always-available `Write` tool is exactly what
 * failed in practice on weaker/older models. This hook closes the remaining gap — a model
 * that still tries to `Write` into that directory out of habit (or because it never
 * loaded/read the rules) is blocked by the harness itself, independent of which model is
 * driving. See ADR-0030.
 *
 * Installed by `create-obsidian-memory` into `~/.claude/hooks/` next to the SessionStart
 * hook, registered in `~/.claude/settings.json` as:
 *   node "<this file>" "<claudeDir>" [lang]
 * with matcher `"Write|Edit|MultiEdit|NotebookEdit"` so the harness only invokes it for
 * file-mutating tools. The script re-checks `tool_name` itself too, defensively.
 *
 * Contract (Claude Code `PreToolUse` hooks):
 *  - Read the hook's JSON payload from stdin (`tool_name`, `tool_input`, …).
 *  - To deny the call, print ONE JSON object to stdout:
 *      { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *          "permissionDecision": "deny", "permissionDecisionReason": "<text>" } }
 *  - To defer to the normal permission flow, print nothing and exit 0.
 *  - Never throw: a malformed payload or unreadable input must fall through to the
 *    normal permission flow, not break the user's tool call.
 */
import fs from "node:fs";
import path from "node:path";

const MUTATING_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** True if `filePath` lives under `<claudeDir>/projects/<anything>/memory/...`. */
function isNativeMemoryPath(filePath, claudeDir) {
  if (!filePath || !claudeDir) return false;
  try {
    const norm = path.resolve(filePath).replace(/\\/g, "/").toLowerCase();
    const dirNorm = path.resolve(claudeDir).replace(/\\/g, "/").toLowerCase();
    if (!norm.startsWith(`${dirNorm}/`)) return false;
    const rel = norm.slice(dirNorm.length + 1).split("/");
    return rel[0] === "projects" && rel.includes("memory");
  } catch {
    return false;
  }
}

function reason(lang) {
  if (lang === "en") {
    return (
      "Blocked: this path is Claude Code's NATIVE auto-memory, disabled by this kit " +
      "(autoMemoryEnabled:false, ADR-0029). Write the close ritual to the Obsidian vault " +
      "instead — mcp__obsidian-memory-hybrid__vault_write_file / vault_edit_file " +
      "(SESSION_LOG.md + PROJECTS/<project>.md), or basic-memory's write_note/edit_note. " +
      "See ADR-0030."
    );
  }
  return (
    "Bloqueado: esa ruta es la auto-memoria NATIVA de Claude Code, desactivada por este kit " +
    "(autoMemoryEnabled:false, ADR-0029). Escribe el cierre en el vault Obsidian en su lugar " +
    "— mcp__obsidian-memory-hybrid__vault_write_file / vault_edit_file " +
    "(SESSION_LOG.md + PROJECTS/<proyecto>.md), o write_note/edit_note de basic-memory. " +
    "Ver ADR-0030."
  );
}

function main() {
  const claudeDir = process.argv[2] || "";
  const lang = (process.argv[3] || "es").toLowerCase() === "en" ? "en" : "es";

  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    return; // unparseable payload — defer to the normal permission flow
  }

  const toolName = typeof input?.tool_name === "string" ? input.tool_name : "";
  if (!MUTATING_TOOLS.test(toolName)) return;

  const filePath = input?.tool_input?.file_path || input?.tool_input?.notebook_path || "";
  if (!isNativeMemoryPath(filePath, claudeDir)) return;

  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason(lang)
    }
  };
  process.stdout.write(JSON.stringify(payload));
}

try {
  main();
} catch {
  // Never let a bug in this hook block a legitimate tool call.
}
