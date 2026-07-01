/**
 * Shared result shaping for the obsidian-memory-hybrid MCP tools.
 *
 * Lives in its own module (like extract.mjs / vault-fs.mjs) so the helpers can
 * be unit-tested without importing hybrid-mcp.mjs, whose top-level main() spawns
 * a StdioServerTransport that blocks on stdin forever.
 *
 * Every tool handler returns either a string (emitted verbatim — e.g. raw file
 * contents) or a JSON-serializable value (pretty-printed). toolHandler() removes
 * the try/catch + isError boilerplate that was otherwise duplicated across all
 * seven tools.
 */

/**
 * Wrap a handler's return value as a successful text CallToolResult.
 * Strings are emitted verbatim; everything else is compact JSON (no pretty-print
 * indentation) — the consumer is an LLM, not a human reading a terminal, and the
 * indentation/newlines of `JSON.stringify(value, null, 2)` cost ~15-25% extra
 * tokens on every search/relations/observations/report response for zero benefit.
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
 * becomes a text result and any thrown error becomes an isError result. This is
 * the single place the try/catch lives, so each tool body stays focused on its
 * own logic instead of repeating error plumbing.
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
