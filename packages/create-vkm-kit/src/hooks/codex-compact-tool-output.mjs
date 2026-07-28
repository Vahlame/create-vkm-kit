#!/usr/bin/env node
// Codex PostToolUse adapter shipped by create-vkm-kit. Codex currently does not support
// updatedToolOutput, so a compacted result is returned as replacement feedback/context.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { compactMcpResponse } from "./compact-mcp-output.mjs";
import { compactToolResponse } from "./compact-tool-output.mjs";

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function asFeedback(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function compactCodexToolResponse(payload) {
  const response = payload?.tool_response;
  return String(payload?.tool_name || "").startsWith("mcp__")
    ? compactMcpResponse(response)
    : compactToolResponse(response);
}

export function main() {
  if (process.env.VKM_TOKEN_SAVER === "0") return;
  const payload = readPayload();
  const compacted = compactCodexToolResponse(payload);
  if (compacted === null || compacted === undefined) return;
  process.stdout.write(
    JSON.stringify({
      continue: false,
      systemMessage: "vkm token-saver compacted the preceding tool output.",
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: asFeedback(compacted)
      }
    })
  );
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    // Fail open: a compaction fault must never interrupt a completed tool call.
  }
}
