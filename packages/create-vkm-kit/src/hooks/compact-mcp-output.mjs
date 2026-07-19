#!/usr/bin/env node
// PostToolUse hook (matcher: mcp__.*) shipped by create-obsidian-memory — the vkm-kit
// token-saver (ADR-0043), MCP flavor. Pretty-printed JSON responses from MCP servers waste
// input tokens on pure indentation; this hook re-serializes any text block that parses as
// JSON into its compact form. STRICTLY whitespace-level: the parsed value is re-emitted
// unchanged (same keys, same order as JSON.parse preserves, same data), so security
// envelopes like the vault's `_trust` field survive byte-comparable at the semantic level.
// Non-JSON text, small payloads, and anything that fails to parse are left untouched; any
// internal failure fails open (prints nothing → Claude Code keeps the original).
//
// Kill switch: set VKM_TOKEN_SAVER=0 to disable without uninstalling.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Below this many saved characters the hook stays silent. */
const MIN_SAVED_CHARS = 200;

/**
 * Compact one text payload IFF it parses as JSON; returns null when unchanged/not JSON.
 * @param {string} text
 */
export function compactJsonText(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const compact = JSON.stringify(parsed);
  return text.length - compact.length >= MIN_SAVED_CHARS ? compact : null;
}

/**
 * Compact an MCP `tool_response`, preserving its shape: a bare string is compacted
 * directly; an object with a `content` array gets each `{type:"text", text}` block
 * compacted in place (other block types and fields pass through verbatim). Returns null
 * when nothing changed.
 * @param {unknown} toolResponse
 */
export function compactMcpResponse(toolResponse) {
  if (typeof toolResponse === "string") return compactJsonText(toolResponse);
  if (!toolResponse || typeof toolResponse !== "object" || Array.isArray(toolResponse)) {
    return null;
  }
  const resp = /** @type {{ content?: unknown }} */ (toolResponse);
  if (!Array.isArray(resp.content)) return null;
  let changed = false;
  const content = resp.content.map((block) => {
    if (block && typeof block === "object" && block.type === "text") {
      const compact = compactJsonText(block.text);
      if (compact !== null) {
        changed = true;
        return { ...block, text: compact };
      }
    }
    return block;
  });
  return changed ? { ...resp, content } : null;
}

function main() {
  if (process.env.VKM_TOKEN_SAVER === "0") return;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return; // fail open
  }
  const updated = compactMcpResponse(payload?.tool_response);
  if (updated === null || updated === undefined) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated }
    })
  );
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    // fail open — a hook crash must never break the tool call
  }
}
