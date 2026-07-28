#!/usr/bin/env node
// Codex PreToolUse guard shipped by create-vkm-kit. Local Codex memories are generated
// state under ~/.codex/memories; route durable notes to the configured Obsidian vault instead.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function normalize(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .toLowerCase();
}

export function referencesCodexMemories(value, codexDir) {
  const candidate = normalize(value);
  const memoryRoot = normalize(path.join(codexDir, "memories"));
  return (
    candidate.includes(`${memoryRoot}/`) ||
    /(?:^|[\s"'])~?\/?\.codex\/memories(?:\/|\b)/.test(candidate)
  );
}

function isLikelyWrite(command) {
  return /(?:\*\*\*\s+(?:add|update|delete|move)\s+file:|>|\b(?:set-content|add-content|out-file|tee|copy-item|move-item|remove-item|del|erase|rm|mv|cp|sed\s+-i)\b)/i.test(
    command
  );
}

function reason(lang) {
  return lang === "es"
    ? "Bloqueado: esa ruta es memoria local generada de Codex (~/.codex/memories/). No la edites manualmente; escribe el cierre durable en el vault Obsidian con las herramientas vault_* (SESSION_LOG.md y PROJECTS/<proyecto>.md)."
    : "Blocked: this path is generated Codex local memory (~/.codex/memories/). Do not edit it manually; write durable close-out notes to the Obsidian vault with vault_* tools (SESSION_LOG.md and PROJECTS/<project>.md).";
}

export function shouldBlock(payload, codexDir) {
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  const input =
    payload?.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
  const command = typeof input.command === "string" ? input.command : "";
  const filePath = typeof input.file_path === "string" ? input.file_path : "";
  if (toolName === "apply_patch") return referencesCodexMemories(command, codexDir);
  return (
    toolName === "Bash" &&
    isLikelyWrite(command) &&
    (referencesCodexMemories(command, codexDir) || referencesCodexMemories(filePath, codexDir))
  );
}

export function main() {
  const codexDir = process.argv[2] || "";
  const lang = (process.argv[3] || "es").toLowerCase() === "en" ? "en" : "es";
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return;
  }
  if (!shouldBlock(payload, codexDir)) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason(lang)
      }
    })
  );
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    // Fail open: malformed hook input must not block a legitimate tool call.
  }
}
