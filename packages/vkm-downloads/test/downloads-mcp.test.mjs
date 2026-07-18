/**
 * Drives the REAL registered MCP handlers (zod validation included) over an in-memory transport,
 * injecting fake download/resolve/log so no network or filesystem is touched. Proves:
 *  - both tools are registered with the right read-only hints;
 *  - download_resolve returns metadata + an untrusted-data note and never invokes the downloader;
 *  - download_file forwards to the downloader, writes an audit-log entry, and returns the path/hash;
 *  - a thrown guard error (blocked address / bad scheme) surfaces as an isError result.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildServer } from "../src/downloads-mcp.mjs";

async function connect(deps) {
  const server = buildServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const textOf = (r) => r.content[0].text;

test("both download tools are registered", async () => {
  const client = await connect({});
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("download_resolve"));
  assert.ok(names.includes("download_file"));
});

test("download_file is marked side-effecting; download_resolve is read-only", async () => {
  const client = await connect({});
  const { tools } = await client.listTools();
  const resolve = tools.find((t) => t.name === "download_resolve");
  const file = tools.find((t) => t.name === "download_file");
  assert.equal(resolve.annotations?.readOnlyHint, true);
  assert.equal(file.annotations?.readOnlyHint, false);
});

test("download_resolve returns metadata + an untrusted note and never downloads", async () => {
  let downloaded = false;
  const resolveImpl = async (url) => ({
    final_url: url,
    filename: "report.pdf",
    content_type: "application/pdf",
    size_bytes: 2048
  });
  const downloadImpl = async () => {
    downloaded = true;
    return {};
  };
  const client = await connect({ resolveImpl, downloadImpl, logImpl: () => {} });
  const res = await client.callTool({
    name: "download_resolve",
    arguments: { url: "https://cdn.test/report.pdf" }
  });
  const data = JSON.parse(textOf(res));
  assert.equal(data.filename, "report.pdf");
  assert.equal(data.size_bytes, 2048);
  assert.match(data._trust, /untrusted/i);
  assert.match(data._note, /confirmation before calling download_file/i);
  assert.equal(downloaded, false, "resolve must never trigger a download");
});

test("download_file forwards to the downloader, logs, and returns the saved path + hash", async () => {
  let logged = null;
  const downloadImpl = async (url, opts) => {
    assert.equal(url, "https://cdn.test/a.zip");
    assert.equal(opts.filename, "custom.zip");
    return {
      path: "/home/u/Downloads/vkm-kit/custom.zip",
      filename: "custom.zip",
      size_bytes: 123,
      sha256: "abc123",
      content_type: "application/zip",
      final_url: url
    };
  };
  const client = await connect({ downloadImpl, logImpl: (e) => (logged = e) });
  const res = await client.callTool({
    name: "download_file",
    arguments: { url: "https://cdn.test/a.zip", filename: "custom.zip" }
  });
  const data = JSON.parse(textOf(res));
  assert.equal(data.path, "/home/u/Downloads/vkm-kit/custom.zip");
  assert.equal(data.sha256, "abc123");
  assert.match(data._note, /NOT opened or executed/);
  assert.equal(logged.saved, "/home/u/Downloads/vkm-kit/custom.zip");
  assert.equal(logged.sha256, "abc123");
});

test("download_file surfaces a guard error as an isError result", async () => {
  const downloadImpl = async () => {
    const e = new Error(
      'Refusing to download from "internal.test": it resolves to a private/loopback address (127.0.0.1).'
    );
    e.code = "blocked_address";
    throw e;
  };
  const client = await connect({ downloadImpl, logImpl: () => {} });
  const res = await client.callTool({
    name: "download_file",
    arguments: { url: "https://internal.test/x" }
  });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /private\/loopback/);
});

test("download_file never logs when the download fails", async () => {
  let logged = false;
  const downloadImpl = async () => {
    throw new Error("boom");
  };
  const client = await connect({ downloadImpl, logImpl: () => (logged = true) });
  const res = await client.callTool({
    name: "download_file",
    arguments: { url: "https://cdn.test/x" }
  });
  assert.equal(res.isError, true);
  assert.equal(logged, false, "a failed download must not be recorded as if it happened");
});

// ── async / large-file / mirror tools ─────────────────────────────────────────────────────

test("all six download tools are registered", async () => {
  const client = await connect({});
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const n of [
    "download_resolve",
    "download_file",
    "download_start",
    "download_status",
    "download_cancel",
    "probe_mirrors"
  ]) {
    assert.ok(names.includes(n), `missing tool: ${n}`);
  }
});

test("download_start / download_status / download_cancel side-effecting hints are correct", async () => {
  const client = await connect({});
  const tools = (await client.listTools()).tools;
  const by = (n) => tools.find((t) => t.name === n);
  assert.equal(by("download_start").annotations?.readOnlyHint, false);
  assert.equal(by("download_status").annotations?.readOnlyHint, true);
  assert.equal(by("download_cancel").annotations?.readOnlyHint, false);
  assert.equal(by("probe_mirrors").annotations?.readOnlyHint, true);
});

test("download_file forwards max_bytes to the downloader", async () => {
  let seen = null;
  const downloadImpl = async (url, opts) => {
    seen = opts;
    return {
      path: "/d/x",
      filename: "x",
      size_bytes: 1,
      sha256: "h",
      content_type: null,
      final_url: url
    };
  };
  const client = await connect({ downloadImpl, logImpl: () => {} });
  await client.callTool({
    name: "download_file",
    arguments: { url: "https://cdn.test/x", max_bytes: 12345 }
  });
  assert.equal(seen.maxBytes, 12345);
});

test("download_start forwards the spec to the manager, logs, and returns the job", async () => {
  let startedSpec = null;
  let logged = null;
  const manager = {
    start(spec) {
      startedSpec = spec;
      return { job_id: "job-1", state: "running", files: spec.files.map((f, i) => ({ index: i })) };
    }
  };
  const client = await connect({ manager, logImpl: (e) => (logged = e) });
  const res = await client.callTool({
    name: "download_start",
    arguments: {
      files: [{ urls: ["https://a.test/f", "https://b.test/f"] }],
      max_bytes: 999,
      prefer_fastest: true
    }
  });
  const data = JSON.parse(textOf(res));
  assert.equal(data.job_id, "job-1");
  assert.match(data._note, /background/i);
  assert.equal(startedSpec.maxBytes, 999);
  assert.equal(startedSpec.preferFastest, true);
  assert.equal(startedSpec.files[0].urls.length, 2);
  assert.equal(logged.event, "download_start");
  assert.equal(logged.job_id, "job-1");
});

test("download_status and download_cancel forward the job_id to the manager", async () => {
  const calls = [];
  const manager = {
    status(id) {
      calls.push(["status", id]);
      return { job_id: id, state: "done", files: [] };
    },
    cancel(id) {
      calls.push(["cancel", id]);
      return { job_id: id, state: "cancelled", files: [] };
    }
  };
  const client = await connect({ manager });
  const s = await client.callTool({ name: "download_status", arguments: { job_id: "j9" } });
  assert.equal(JSON.parse(textOf(s)).state, "done");
  const c = await client.callTool({ name: "download_cancel", arguments: { job_id: "j9" } });
  assert.equal(JSON.parse(textOf(c)).state, "cancelled");
  assert.deepEqual(calls, [
    ["status", "j9"],
    ["cancel", "j9"]
  ]);
});

test("probe_mirrors returns the ranking and the fastest url", async () => {
  const probeImpl = async (urls) => [
    { url: urls[1], ok: true, throughput_bps: 5000, latency_ms: 2, rank: 1 },
    { url: urls[0], ok: true, throughput_bps: 100, latency_ms: 9, rank: 2 }
  ];
  const client = await connect({ probeImpl });
  const res = await client.callTool({
    name: "probe_mirrors",
    arguments: { urls: ["https://slow.test/f", "https://fast.test/f"] }
  });
  const data = JSON.parse(textOf(res));
  assert.equal(data.fastest, "https://fast.test/f");
  assert.equal(data.ranked[0].rank, 1);
  assert.match(data._trust, /untrusted/i);
});
