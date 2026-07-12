/**
 * Shared result shaping for the obscura-web MCP tools.
 *
 * A deliberate, self-contained copy of obsidian-memory-mcp/src/mcp-result.mjs
 * (generic, non-security boilerplate) so this package stays independently
 * runnable/versionable — the monorepo's packages are decoupled by convention and
 * this avoids the first cross-workspace runtime dependency. Keep behavior identical.
 *
 * Every tool handler returns either a string (emitted verbatim) or a
 * JSON-serializable value (compact JSON). toolHandler() removes the try/catch +
 * isError boilerplate that would otherwise repeat across each tool.
 */

/**
 * Wrap a handler's return value as a successful text CallToolResult.
 * Strings are emitted verbatim; everything else is compact JSON (the consumer is
 * an LLM, so pretty-print indentation only costs tokens).
 * @param {unknown} value
 * @returns {{ content: { type: "text", text: string }[] }}
 */
export function asTextResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }] };
}

/**
 * Wrap a thrown value as an error CallToolResult (isError: true).
 * @param {unknown} err
 * @returns {{ content: { type: "text", text: string }[], isError: true }}
 */
export function asErrorResult(err) {
  const text = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Adapt a plain async tool function into an MCP handler: its resolved value
 * becomes a text result and any thrown error becomes an isError result.
 * @template A
 * @param {(args: A) => unknown | Promise<unknown>} fn
 * @returns {(args: A) => Promise<ReturnType<typeof asTextResult> | ReturnType<typeof asErrorResult>>}
 */
export function toolHandler(fn) {
  return async (args) => {
    try {
      return asTextResult(await fn(args));
    } catch (err) {
      return asErrorResult(err);
    }
  };
}
