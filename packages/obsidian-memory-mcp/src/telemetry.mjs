/**
 * Optional OpenTelemetry startup for the MCP sidecar.
 *
 * # Nothing here may write to stdout
 *
 * This process speaks JSON-RPC over stdio: `StdioServerTransport` IS stdout. Any
 * other byte on that stream is a protocol frame as far as the client's parser is
 * concerned. This module used to build a `pino` logger with no destination — pino's
 * default is stdout — and then log `"OpenTelemetry SDK started (OTLP HTTP)"` at info
 * level on the exact path a normal install takes: `create-vkm-kit/src/telemetry.mjs`
 * writes `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4319` into the agent's
 * settings, the sidecar inherits it, and `maybeStartOtel()` reaches that line.
 *
 * The fix is not a configured logger, it is no logger: a module with one
 * best-effort startup message does not earn a logging dependency, and `pino` was in
 * `dependencies` solely for a `logMcpTurn` export that nothing but its own test ever
 * called. `console.error` goes to stderr, which the client shows as server logs and
 * never parses.
 */

/** stderr only — see the module note. @param {string} msg */
function note(msg) {
  console.error(`[obsidian-memory-mcp] ${msg}`);
}

/**
 * Start the OpenTelemetry SDK when tracing is opt-in *and* available.
 *
 * Opt-in contract (see docs/en/observability.md): activate only when an OTLP
 * endpoint is configured via env. Without it we skip entirely, so installing
 * the optional deps alone never fires exports at a non-existent local collector.
 * Errors (e.g. optional deps absent) are swallowed — tracing is best-effort.
 * @returns {Promise<boolean>} true when the SDK was started, false when skipped.
 */
export async function maybeStartOtel() {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (!endpoint) return false;
  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
    sdk.start();
    note("OpenTelemetry SDK started (OTLP HTTP)");
    return true;
  } catch {
    // Optional deps absent is the normal case, not a problem worth a line.
    return false;
  }
}
