import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseOtlpJson, appendRollup, createSink, pruneOld } from "../src/otel-sink.mjs";
import { aggregate, renderReport } from "../src/doctor.mjs";

/** A realistic OTLP/HTTP JSON ExportMetricsServiceRequest fixture (counter as `sum`). */
function otlpFixture() {
  const dp = (type, model, value) => ({
    attributes: [
      { key: "type", value: { stringValue: type } },
      { key: "model", value: { stringValue: model } }
    ],
    timeUnixNano: String(Date.now() * 1e6),
    asDouble: value
  });
  return {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: "claude_code.token.usage",
                sum: {
                  dataPoints: [
                    dp("input", "claude-opus-4-8", 1200),
                    dp("output", "claude-opus-4-8", 300),
                    dp("cacheRead", "claude-opus-4-8", 90000),
                    dp("cacheCreation", "claude-opus-4-8", 4000)
                  ]
                }
              },
              {
                name: "claude_code.cost.usage",
                sum: { dataPoints: [{ attributes: [], asDouble: 0.42 }] }
              },
              { name: "weird.future.metric", histogram: { buckets: [] } }
            ]
          }
        ]
      }
    ]
  };
}

test("parseOtlpJson extracts token datapoints with type/model; unknown shapes counted raw", () => {
  const { points, raw } = parseOtlpJson(otlpFixture());
  assert.equal(points.length, 5);
  const input = points.find((p) => p.type === "input");
  assert.equal(input.value, 1200);
  assert.equal(input.model, "claude-opus-4-8");
  assert.equal(raw, 1); // the future histogram metric
  assert.deepEqual(parseOtlpJson({}).points, []); // tolerant of garbage
  assert.deepEqual(parseOtlpJson(null).points, []);
});

test("aggregate + renderReport: totals, cache-hit ratio, healthy diagnosis", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-doctor-test-"));
  const { points } = parseOtlpJson(otlpFixture());
  appendRollup(dataDir, points);
  appendRollup(dataDir, points); // second batch, same day
  const report = aggregate({ dataDir });
  assert.equal(report.totals.input, 2400);
  assert.equal(report.totals.cacheRead, 180000);
  assert.ok(Math.abs(report.costUSD - 0.84) < 1e-9);
  assert.ok(report.cacheHitRatio > 0.9);
  assert.equal(report.brokenCache, false);
  const text = renderReport(report);
  assert.match(text, /cache-hit ratio: 9\d\.\d%/);
  assert.match(text, /claude-opus-4-8/);
});

test("aggregate flags a broken cache (high input, near-zero cacheRead)", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-doctor-test-"));
  const day = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push({
      ts: new Date().toISOString(),
      metric: "claude_code.token.usage",
      type: "input",
      model: "m",
      value: 20000
    });
    rows.push({
      ts: new Date().toISOString(),
      metric: "claude_code.token.usage",
      type: "cacheRead",
      model: "m",
      value: 100
    });
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, `${day}.ndjson`),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
  const report = aggregate({ dataDir });
  assert.equal(report.brokenCache, true);
  assert.match(renderReport(report), /LOW — the prompt cache looks broken/);
});

test("aggregate ignores a malformed/non-finite value instead of poisoning the whole sum", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-doctor-test-"));
  const day = new Date().toISOString().slice(0, 10);
  const rows = [
    {
      ts: new Date().toISOString(),
      metric: "claude_code.token.usage",
      type: "input",
      model: "m",
      value: 10000
    },
    // A torn write or schema drift could leave `value` non-numeric — must be skipped,
    // not accumulated (NaN would poison every downstream sum/ratio for the whole file).
    {
      ts: new Date().toISOString(),
      metric: "claude_code.token.usage",
      type: "input",
      model: "m",
      value: "not-a-number"
    },
    {
      ts: new Date().toISOString(),
      metric: "claude_code.token.usage",
      type: "cacheRead",
      model: "m",
      value: 90000
    },
    { ts: new Date().toISOString(), metric: "claude_code.cost.usage", value: NaN }
  ];
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, `${day}.ndjson`),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
  const report = aggregate({ dataDir });
  assert.equal(report.totals.input, 10000, "the malformed row must be skipped, not poison the sum");
  assert.equal(report.totals.cacheRead, 90000);
  assert.ok(
    Number.isFinite(report.cacheHitRatio),
    "cacheHitRatio must stay a real number, not NaN"
  );
  assert.equal(report.costUSD, 0, "the NaN cost row must be skipped, not poison costUSD");
});

test("sink HTTP round-trip on an ephemeral port persists NDJSON and answers 200 {}", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-doctor-test-"));
  const server = createSink({ port: 0, dataDir });
  await new Promise((resolve) => server.on("listening", resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/v1/metrics`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(otlpFixture())
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {});
  // Malformed payload: still 200, still alive.
  const bad = await fetch(`http://127.0.0.1:${port}/v1/metrics`, { method: "POST", body: "{nope" });
  assert.equal(bad.status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/other`)).status, 404);
  server.close();
  const day = new Date().toISOString().slice(0, 10);
  const lines = fs
    .readFileSync(path.join(dataDir, `${day}.ndjson`), "utf8")
    .trim()
    .split("\n");
  assert.equal(lines.length, 5);
  assert.ok(fs.existsSync(path.join(dataDir, "sink.lock")));
});

test("pruneOld removes files past the cutoff and keeps recent ones", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vkm-doctor-test-"));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "2020-01-01.ndjson"), "{}\n");
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dataDir, `${today}.ndjson`), "{}\n");
  pruneOld(dataDir, 90);
  assert.equal(fs.existsSync(path.join(dataDir, "2020-01-01.ndjson")), false);
  assert.ok(fs.existsSync(path.join(dataDir, `${today}.ndjson`)));
});
