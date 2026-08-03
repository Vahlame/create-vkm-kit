#!/usr/bin/env node
/**
 * Cursor `afterMCPExecution` / `postToolUse` token-saver — compact pretty JSON
 * MCP payloads. Same semantics as compact-mcp-output.mjs, Cursor output shape:
 * `{ "updated_mcp_tool_output": <value> }` (create-hook cheat sheet).
 *
 * Kill switch: VKM_TOKEN_SAVER=0. Installed by create-vkm-kit (vkm-kit).
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { compactMcpResponse } from "./compact-mcp-output.mjs";

function extractResponse(input) {
  if (!input || typeof input !== "object") return undefined;
  return (
    input.tool_response ??
    input.toolResponse ??
    input.result ??
    input.output ??
    input.mcp_tool_output ??
    input.mcpToolOutput
  );
}

export function main() {
  if (process.env.VKM_TOKEN_SAVER === "0") return;
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return;
  }
  const updated = compactMcpResponse(extractResponse(input));
  if (updated === null || updated === undefined) return;
  process.stdout.write(JSON.stringify({ updated_mcp_tool_output: updated }));
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    /* fail open */
  }
}
