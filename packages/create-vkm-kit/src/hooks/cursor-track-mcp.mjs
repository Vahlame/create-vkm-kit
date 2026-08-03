#!/usr/bin/env node
/**
 * Cursor `afterMCPExecution` / `postToolUse` tracker — marks vault close-ritual
 * tools so the stop reminder stands down when the agent already persisted.
 * Installed by create-vkm-kit (vkm-kit). Always fail-open.
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { noteMcpTool } from "./cursor-session-state.mjs";

function toolNameFrom(input) {
  if (!input || typeof input !== "object") return "";
  const candidates = [
    input.tool_name,
    input.toolName,
    input.name,
    input.tool?.name,
    input.mcp_tool_name,
    input.mcpToolName
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  // Cursor sometimes nests server + tool: "obsidian-memory-hybrid:vault_append_file"
  const combined = input.server && input.tool ? `${input.server}:${input.tool}` : "";
  return typeof combined === "string" ? combined : "";
}

export function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return;
  }
  noteMcpTool(toolNameFrom(input));
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    /* fail open */
  }
}
