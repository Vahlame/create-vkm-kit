/**
 * Tool-doc drift gate: the README's "22 tools" table is the authoritative,
 * human-facing list of what this MCP exposes. Docs describing a different tool
 * count than the code registers is exactly the kind of drift a reader can't
 * detect — so it fails the build instead.
 *
 * It parses the source (no server spawn): every string literal fed to
 * `server.registerTool(` in hybrid-mcp.mjs must appear (backtick-quoted) in
 * this package's README, and the README must not name a vault tool that is no
 * longer registered.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "hybrid-mcp.mjs");
const README = path.join(ROOT, "README.md");

function registeredTools(src) {
  const re = /registerTool\(\s*\n?\s*"([a-z0-9_]+)"/g;
  return [...src.matchAll(re)].map((m) => m[1]);
}

function documentedTools(md) {
  // Backtick-quoted tool names in the README tables/prose.
  const re = /`(vault_[a-z0-9_]+|assemble_context|memory_extract_candidates)`/g;
  return new Set([...md.matchAll(re)].map((m) => m[1]));
}

test("every registered tool is documented in the README", () => {
  const tools = registeredTools(readFileSync(SRC, "utf8"));
  assert.ok(tools.length >= 20, `regex should find the registrations (got ${tools.length})`);
  const documented = documentedTools(readFileSync(README, "utf8"));
  for (const tool of tools) {
    assert.ok(
      documented.has(tool),
      `tool "${tool}" is registered in hybrid-mcp.mjs but missing from README.md — add it to the table`
    );
  }
});

test("the README does not document tools that no longer exist", () => {
  const tools = new Set(registeredTools(readFileSync(SRC, "utf8")));
  // Params/knobs are documented inline (e.g. `graph`), so only check names that
  // look like tools: the vault_/assemble_/memory_ namespaces.
  const documented = documentedTools(readFileSync(README, "utf8"));
  for (const name of documented) {
    assert.ok(
      tools.has(name),
      `README.md names "${name}" but hybrid-mcp.mjs no longer registers it — remove or rename it`
    );
  }
});

test("the README states the correct tool count", () => {
  const count = registeredTools(readFileSync(SRC, "utf8")).length;
  const md = readFileSync(README, "utf8");
  assert.ok(
    md.includes(`${count} vault tools`) || md.includes(`${count} tools`),
    `README.md should state the real tool count (${count}) — update the headline number`
  );
});
