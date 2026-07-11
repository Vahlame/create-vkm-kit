#!/usr/bin/env node
// vkm-otel-sink (ADR-0044): a tiny localhost-only OTLP/HTTP receiver for Claude Code's
// telemetry. Claude Code exports OTLP metrics (`CLAUDE_CODE_ENABLE_TELEMETRY=1`,
// `OTEL_METRICS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
// `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4319`); this sink accepts the JSON
// protocol on POST /v1/metrics — no protobuf, no OTel SDK, ~zero dependencies — extracts
// the datapoints `vkm-doctor` cares about (`claude_code.token.usage` with type/model
// attributes, `claude_code.cost.usage`) and appends compact NDJSON rollups to
// `~/.vkm/telemetry/YYYY-MM-DD.ndjson`. Data never leaves the machine.
//
// Liveness model: a `SessionStart` hook (ensure-otel-sink.mjs, installed by
// create-vkm-kit) spawns this process detached when it isn't running — a lockfile
// (`~/.vkm/telemetry/sink.lock`, pid + port) makes it a singleton without any OS service.
// Fail-open everywhere: a malformed export payload is answered 200 and archived raw, never
// crashed on — losing one datapoint beats losing the sink.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_PORT = 4319;

/** `~/.vkm/telemetry` (override with VKM_TELEMETRY_DIR — tests use ephemeral dirs). */
export function defaultDataDir() {
  return process.env.VKM_TELEMETRY_DIR || path.join(os.homedir(), ".vkm", "telemetry");
}

/** Metric names worth structured extraction; anything else is kept raw for forward-compat. */
const KNOWN_METRICS = new Set([
  "claude_code.token.usage",
  "claude_code.cost.usage",
  "claude_code.session.count",
  "claude_code.active_time.total"
]);

function attrValue(v) {
  if (!v || typeof v !== "object") return undefined;
  return v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue;
}

/**
 * Parse an OTLP/HTTP JSON `ExportMetricsServiceRequest` into flat datapoints. Tolerant by
 * design (ADR-0044 risk: payload shape drift between Claude Code versions): anything that
 * doesn't look like a known metric datapoint is summarized into a `raw` entry instead of
 * throwing, so a future shape change degrades to "stored but unaggregated", never a crash.
 * @param {unknown} body - parsed JSON payload
 * @returns {{ points: Array<{ts: string, metric: string, type?: string, model?: string,
 *   value: number}>, raw: number }}
 */
export function parseOtlpJson(body) {
  const points = [];
  let raw = 0;
  const resourceMetrics = Array.isArray(body?.resourceMetrics) ? body.resourceMetrics : [];
  for (const rm of resourceMetrics) {
    const scopeMetrics = Array.isArray(rm?.scopeMetrics) ? rm.scopeMetrics : [];
    for (const sm of scopeMetrics) {
      const metrics = Array.isArray(sm?.metrics) ? sm.metrics : [];
      for (const metric of metrics) {
        const name = metric?.name;
        // Counters arrive as `sum`; gauges as `gauge` — both carry dataPoints. Any OTHER
        // shape (histogram, future types) is counted as raw, not silently dropped.
        const dataPoints = metric?.sum?.dataPoints ?? metric?.gauge?.dataPoints;
        if (!Array.isArray(dataPoints) || typeof name !== "string") {
          raw += 1;
          continue;
        }
        for (const dp of dataPoints) {
          const value = Number(dp?.asDouble ?? dp?.asInt ?? NaN);
          if (Number.isNaN(value)) {
            raw += 1;
            continue;
          }
          const attrs = {};
          for (const kv of Array.isArray(dp?.attributes) ? dp.attributes : []) {
            if (kv?.key) attrs[kv.key] = attrValue(kv.value);
          }
          const tsNano = Number(dp?.timeUnixNano ?? 0);
          points.push({
            ts: new Date(tsNano ? tsNano / 1e6 : Date.now()).toISOString(),
            metric: name,
            ...(attrs.type !== undefined ? { type: String(attrs.type) } : {}),
            ...(attrs.model !== undefined ? { model: String(attrs.model) } : {}),
            ...(KNOWN_METRICS.has(name) ? {} : { unknown: true }),
            value
          });
        }
      }
    }
  }
  return { points, raw };
}

/** Append points as compact NDJSON to today's file; prune files older than 90 days. */
export function appendRollup(dataDir, points) {
  if (!points.length) return;
  fs.mkdirSync(dataDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const fp = path.join(dataDir, `${day}.ndjson`);
  fs.appendFileSync(fp, points.map((p) => JSON.stringify(p)).join("\n") + "\n", "utf8");
  pruneOld(dataDir, 90);
}

/** Delete telemetry files older than `days` (best-effort). */
export function pruneOld(dataDir, days) {
  const cutoff = Date.now() - days * 86400000;
  let entries = [];
  try {
    entries = fs.readdirSync(dataDir);
  } catch {
    return;
  }
  for (const name of entries) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\.ndjson$/);
    if (!m) continue;
    if (new Date(m[1]).getTime() < cutoff) {
      try {
        fs.rmSync(path.join(dataDir, name));
      } catch {
        // best-effort
      }
    }
  }
}

/** Lockfile helpers: `{pid, port}` JSON. A lock whose pid is dead is stale. */
export function readLock(dataDir) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dataDir, "sink.lock"), "utf8"));
    process.kill(lock.pid, 0); // throws if the process is gone
    return lock;
  } catch {
    return null;
  }
}

function writeLock(dataDir, port) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "sink.lock"),
    JSON.stringify({ pid: process.pid, port }),
    "utf8"
  );
}

/**
 * Start the sink on 127.0.0.1. Returns the http server (tests close it; the CLI runs until
 * killed). EADDRINUSE with a live lock = another sink already serves — exit quietly.
 * @param {{ port?: number, dataDir?: string }} [opts]
 */
export function createSink({ port = DEFAULT_PORT, dataDir = defaultDataDir() } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/v1/metrics")) {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const { points } = parseOtlpJson(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        appendRollup(dataDir, points);
      } catch {
        // fail open: a malformed export must never crash the sink
      }
      // Empty ExportMetricsServiceResponse == full success (OTLP/HTTP spec).
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  server.listen(port, "127.0.0.1", () => writeLock(dataDir, port));
  return server;
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  const dataDir = defaultDataDir();
  if (readLock(dataDir)) {
    process.exit(0); // live sibling already serving
  }
  const server = createSink({ dataDir });
  server.on("error", (e) => {
    // Port taken without a readable lock (e.g. another user): nothing to do, exit quietly.
    process.exit(e?.code === "EADDRINUSE" ? 0 : 1);
  });
}
