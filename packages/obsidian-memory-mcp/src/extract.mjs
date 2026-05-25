/**
 * Pure helpers for the `memory_extract_candidates` MCP tool.
 *
 * Lives in its own module (not hybrid-mcp.mjs) so unit tests can import
 * `extractBullets` / `pickQueryTerms` without triggering hybrid-mcp.mjs's
 * top-level `main()` which spawns a StdioServerTransport that waits on
 * stdin forever — that turned CI's `test-node` job into an infinite hang.
 */

/**
 * Pull bullet lines out of free-form summary text. Recognizes "- ..." and "* ..." list items;
 * if none, falls back to sentence splitting. Trims and skips trivial entries.
 * @param {string} text
 * @returns {string[]}
 */
export function extractBullets(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const body = line.replace(/^[-*]\s+/, "").trim();
      if (body.length >= 8) out.push(body);
    }
  }
  if (out.length > 0) return out;
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16);
}

/**
 * Pick up to 3 meaningful query terms from a bullet for BM25 lookup.
 * Drops short / stopword-ish tokens, keeps alphanumeric/identifier-shaped words.
 * @param {string} bullet
 */
export function pickQueryTerms(bullet) {
  const tokens = bullet
    .split(/\s+/)
    .map((w) => w.replace(/[.,;:!?()`"']+$/g, "").replace(/^[.,;:!?()`"']+/g, ""))
    .filter((w) => w.length >= 4 && /^[\w][\w-]*$/.test(w));
  return tokens.slice(0, 3).join(" ");
}
