/**
 * Merge basic-memory MCP server entry into an existing mcp.json object.
 * @param {unknown} raw - parsed JSON root object
 * @param {string} vaultAbs - absolute vault path for BASIC_MEMORY_HOME
 * @returns {Record<string, unknown>}
 */
export function mergeBasicMemoryServer(raw, vaultAbs) {
  const base =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(raw)))
      : {};
  const servers = base.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    base.mcpServers = {};
  }
  const mcpServers = /** @type {Record<string, unknown>} */ (base.mcpServers);
  mcpServers["basic-memory"] = {
    command: "uvx",
    args: ["basic-memory", "mcp"],
    env: { BASIC_MEMORY_HOME: vaultAbs },
  };
  return base;
}
