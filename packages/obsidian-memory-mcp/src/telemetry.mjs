/**
 * Telemetry helpers for MCP sidecar (OpenTelemetry + pino).
 * OTLP exporters are optional — install optionalDependencies to enable.
 */
import pino from "pino";

const log = pino({
  name: "obsidian-memory-mcp",
});

/** @typedef {{ traceparent?: string }} TraceMeta */

/** Log structured MCP turn metadata (replace with OTel span when SDK present). */
export function logMcpTurn(meta, payload) {
  log.info({ ...payload, traceparent: meta.traceparent }, "mcp_turn");
}

export async function maybeStartOtel() {
  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const exporter = new OTLPTraceExporter();
    const sdk = new NodeSDK({ traceExporter: exporter });
    await sdk.start();
    log.info("OpenTelemetry SDK started (OTLP HTTP)");
  } catch {
    log.debug("OpenTelemetry SDK not installed; skipping");
  }
}
