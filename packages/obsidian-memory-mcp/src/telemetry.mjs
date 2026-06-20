/**
 * Telemetry helpers for MCP sidecar (OpenTelemetry + pino).
 * OTLP exporters are optional — install optionalDependencies to enable.
 */
import pino from "pino";

const log = pino({
  name: "obsidian-memory-mcp"
});

/** @typedef {{ traceparent?: string }} TraceMeta */

/** Log structured MCP turn metadata (replace with OTel span when SDK present). */
export function logMcpTurn(meta, payload) {
  log.info({ ...payload, traceparent: meta.traceparent }, "mcp_turn");
}

/**
 * Start the OpenTelemetry SDK when tracing is opt-in *and* available.
 *
 * Opt-in contract (see docs/observability.md): activate only when an OTLP
 * endpoint is configured via env. Without it we skip entirely, so installing
 * the optional deps alone never fires exports at a non-existent local collector.
 * Errors (e.g. optional deps absent) are swallowed — tracing is best-effort.
 * @returns {Promise<boolean>} true when the SDK was started, false when skipped.
 */
export async function maybeStartOtel() {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (!endpoint) {
    log.debug("OTEL endpoint not set; tracing disabled");
    return false;
  }
  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const exporter = new OTLPTraceExporter();
    const sdk = new NodeSDK({ traceExporter: exporter });
    await sdk.start();
    log.info("OpenTelemetry SDK started (OTLP HTTP)");
    return true;
  } catch {
    log.debug("OpenTelemetry SDK not installed; skipping");
    return false;
  }
}
