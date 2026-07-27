/**
 * Result shaping and stdio-server plumbing shared by every MCP sidecar in the kit.
 *
 * # Why this is one module and not three
 *
 * The three servers (vault, obscura-web, downloads) were built by copy-paste from
 * each other, so `asTextResult` / `asErrorResult` / `toolHandler` existed three
 * times, byte-identical once the header prose was stripped, and the `pkgVersion`
 * IIFE and the `main()` tail existed three times on top of that. Two of the copies
 * justified themselves with the same sentence — "avoids the first cross-workspace
 * runtime dependency" (ADR-0051 decision #6) — a premise that was already false
 * when it was written down: `vkm-spec` deep-imports `@vkmikc/obsidian-memory-mcp`
 * and `vkm-doctor` deep-imports `@vkmikc/create-vkm-kit`.
 *
 * This package exists so the shared layer has a home that is nobody's feature
 * package: `vkm-downloads` importing a helper from the *memory* MCP would be a
 * dependency edge that only makes sense as an accident of history.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

/**
 * The `version` from the package.json next to a server module, for the MCP
 * handshake. Never throws: a server that cannot read its own manifest should
 * still start, reporting an obviously-wrong version rather than failing to boot.
 * @param {string} importMetaUrl the caller's `import.meta.url`
 * @returns {string}
 */
export function pkgVersionFrom(importMetaUrl) {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", importMetaUrl), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

/**
 * True when this module's file is the process entry point.
 *
 * The naive form (`import.meta.url === "file://" + process.argv[1]`) never matches
 * on Windows — `process.argv[1]` is a native path with backslashes and no `/C:/`
 * prefix — so `main()` silently never runs and the process exits 0 having done
 * nothing, which is indistinguishable from success. This repo shipped that bug
 * twelve times before an eslint rule (`no-restricted-syntax`, see
 * eslint.config.mjs) made the shape impossible; this helper is the correct form
 * those call sites should use.
 * @param {string} importMetaUrl the caller's `import.meta.url`
 * @returns {boolean}
 */
export function isEntryPoint(importMetaUrl) {
  return Boolean(process.argv[1]) && importMetaUrl === pathToFileURL(process.argv[1]).href;
}
