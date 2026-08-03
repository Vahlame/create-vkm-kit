import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { createService, AlreadyRunningError } from "../src/pg-service.mjs";
import { ensureServiceRunning } from "../src/pg-http-client.mjs";
import { runMigrate } from "../src/migrate.mjs";
import { openAdapter } from "../src/pg-adapter.mjs";
import {
  vaultPgDir,
  readToken,
  readServiceInfo,
  lockPath,
  serviceInfoPath
} from "../src/pg-paths.mjs";
import { isValidScope, pathInScope } from "../src/scope.mjs";
import { tryOpenMemory, makeDump, vecB64 } from "./helpers.mjs";

const probe = await tryOpenMemory();
if (probe) await probe.close();
const skip = probe ? false : "PGlite WASM failed to initialize on this platform";

/** Minimal SSE reader: buffers the stream, lets tests await a substring. */
function openSse(base, token) {
  /** @type {(chunk: string) => void} */
  let onChunk = () => {};
  let buffer = "";
  const req = http.get(`${base}/api/events`, { headers: { "x-vkm-pg-token": token } }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buffer += chunk;
      onChunk(buffer);
    });
    res.on("error", () => {});
  });
  req.on("error", () => {});
  return {
    waitFor(substr, timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        if (buffer.includes(substr)) return resolve(buffer);
        const timer = setTimeout(
          () =>
            reject(new Error(`SSE timeout waiting for ${substr}; got: ${buffer.slice(0, 400)}`)),
          timeoutMs
        );
        onChunk = (buf) => {
          if (buf.includes(substr)) {
            clearTimeout(timer);
            resolve(buf);
          }
        };
      });
    },
    close() {
      req.destroy();
    }
  };
}

/** A pid that is guaranteed dead: a real child that already exited. */
async function spawnDeadPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore", windowsHide: true });
  const pid = child.pid;
  await new Promise((res) => child.once("exit", res));
  return pid;
}

async function bootService({ initialSync = true, deps = {} } = {}) {
  const vault = mkdtempSync(join(tmpdir(), "vkm-pg-vault-"));
  const dataRoot = mkdtempSync(join(tmpdir(), "vkm-pg-data-"));
  const env = { VKM_PG_MEMORY: "1", VKM_PG_DATA_ROOT: dataRoot };
  const service = createService({
    vaultAbs: vault,
    env,
    watch: false,
    initialSync,
    deps: { runDump: async () => makeDump(), ...deps }
  });
  const port = await service.start();
  const dir = vaultPgDir(vault, env);
  return {
    service,
    env,
    vault,
    dir,
    base: `http://127.0.0.1:${port}`,
    port,
    token: readToken(dir) ?? "",
    async cleanup() {
      await service.stop();
      rmSync(vault, { recursive: true, force: true });
      rmSync(dataRoot, { recursive: true, force: true });
    }
  };
}

test("boot on port 0: service.json + lock recorded, health needs no token", { skip }, async () => {
  const s = await bootService();
  try {
    assert.ok(s.port > 0);
    const info = readServiceInfo(s.dir);
    assert.ok(info, "service.json written with a live pid");
    assert.equal(info.port, s.port);
    assert.equal(info.pid, process.pid);
    assert.equal(info.vault, s.vault);
    assert.ok(existsSync(lockPath(s.dir)));
    assert.deepEqual(JSON.parse(readFileSync(lockPath(s.dir), "utf8")), {
      pid: process.pid,
      port: s.port
    });

    const res = await fetch(`${s.base}/api/health`);
    assert.equal(res.status, 200);
    const health = await res.json();
    assert.equal(health.ok, true);
    assert.equal(health.backend, "pglite");
    assert.equal(health.vault, undefined, "unauthenticated health must not leak the vault path");
    assert.equal(health.notes, 3); // initial sync ran against the fake dump
    assert.equal(health.watching, false);
    assert.equal(typeof health.capabilities.vector, "boolean");
    assert.match(String(health.pgVersion), /^\d+\./);
    const stats = await (
      await fetch(`${s.base}/api/stats`, { headers: { "x-vkm-pg-token": s.token } })
    ).json();
    assert.equal(stats.vault, s.vault, "token-gated stats still exposes the vault path");
  } finally {
    await s.cleanup();
  }
});

test("401 with wrong/missing token on /api/stats and /api/sync", { skip }, async () => {
  const s = await bootService();
  try {
    for (const headers of [{}, { "x-vkm-pg-token": "wrong" }]) {
      const stats = await fetch(`${s.base}/api/stats`, { headers });
      assert.equal(stats.status, 401);
      assert.deepEqual(await stats.json(), { error: "unauthorized" });
      const sync = await fetch(`${s.base}/api/sync`, { method: "POST", headers, body: "{}" });
      assert.equal(sync.status, 401);
      assert.deepEqual(await sync.json(), { error: "unauthorized" });
    }
  } finally {
    await s.cleanup();
  }
});

test("POST /api/sync with the token returns the contract synced object", { skip }, async () => {
  const s = await bootService();
  try {
    const res = await fetch(`${s.base}/api/sync`, {
      method: "POST",
      headers: { "x-vkm-pg-token": s.token, "content-type": "application/json" },
      body: JSON.stringify({ mode: "full" })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.synced, {
      notes: 3,
      chunks: 2,
      relations: 3,
      observations: 1,
      removed: 0
    });
    assert.equal(body.cursor, 300);
    assert.ok(body.tookMs >= 0);
  } finally {
    await s.cleanup();
  }
});

test("fts search round-trips accents over HTTP", { skip }, async () => {
  const s = await bootService();
  try {
    const res = await fetch(`${s.base}/api/search`, {
      method: "POST",
      headers: { "x-vkm-pg-token": s.token, "content-type": "application/json" },
      body: JSON.stringify({ q: "Canción", mode: "fts" })
    });
    assert.equal(res.status, 200);
    const { hits } = await res.json();
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, "PROJECTS/alpha.md");
    assert.equal(typeof hits[0].rank, "number");
  } finally {
    await s.cleanup();
  }
});

test("SSE: hello frame on connect, activity frame after a notify", { skip }, async () => {
  const s = await bootService();
  const sse = openSse(s.base, s.token);
  try {
    const afterHello = await sse.waitFor("event: hello");
    assert.match(afterHello, /event: hello\ndata: \{"lastId":\d+\}/);

    const adapter = s.service.getAdapter();
    const { rows } = await adapter.query(
      "INSERT INTO activity(kind, path, detail) VALUES ('note_upsert', 'X.md', '{}'::jsonb) RETURNING id"
    );
    const id = Number(rows[0].id);
    // The listen subscription races the hello frame; re-notify until the frame lands.
    const done = sse.waitFor("event: activity");
    const pump = setInterval(() => {
      adapter.notify("vkm_activity", String(id)).catch(() => {});
    }, 150);
    let framed;
    try {
      framed = await done;
    } finally {
      clearInterval(pump);
    }
    const dataLine = framed
      .split("\n")
      .find((l, i, all) => all[i - 1] === "event: activity" && l.startsWith("data: "));
    assert.ok(dataLine, "activity frame carries a data line");
    const event = JSON.parse(dataLine.slice("data: ".length));
    assert.equal(event.id, id);
    assert.equal(event.kind, "note_upsert");
    assert.equal(event.path, "X.md");
    assert.deepEqual(event.detail, {});
  } finally {
    sse.close();
    await s.cleanup();
  }
});

test("stop() removes service.json and the lock", { skip }, async () => {
  const vault = mkdtempSync(join(tmpdir(), "vkm-pg-vault-"));
  const dataRoot = mkdtempSync(join(tmpdir(), "vkm-pg-data-"));
  const env = { VKM_PG_MEMORY: "1", VKM_PG_DATA_ROOT: dataRoot };
  const service = createService({
    vaultAbs: vault,
    env,
    watch: false,
    initialSync: false,
    deps: { runDump: async () => makeDump() }
  });
  try {
    await service.start();
    const dir = vaultPgDir(vault, env);
    assert.ok(readServiceInfo(dir));
    await service.stop();
    assert.equal(readServiceInfo(dir), null);
    assert.ok(!existsSync(lockPath(dir)));
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test(
  "migrate completes deterministically when Ollama throws (enrichment skipped)",
  { skip },
  async () => {
    const vault = mkdtempSync(join(tmpdir(), "vkm-pg-mig-vault-"));
    const dataRoot = mkdtempSync(join(tmpdir(), "vkm-pg-mig-data-"));
    const env = { VKM_PG_MEMORY: "1", VKM_PG_DATA_ROOT: dataRoot };
    const adapter = await openAdapter({ vaultAbs: vault, env });
    try {
      const explodingOllama = {
        check: async () => {
          throw new Error("ollama exploded");
        },
        chat: async () => {
          throw new Error("ollama exploded");
        }
      };
      const summary = await runMigrate(
        { vaultAbs: vault, env, full: true, enrich: 5, yes: true },
        { adapter, runDump: async () => makeDump(), ollama: explodingOllama }
      );
      assert.equal(summary.ok, true);
      assert.equal(summary.via, "direct");
      assert.deepEqual(summary.synced, {
        notes: 3,
        chunks: 2,
        relations: 3,
        observations: 1,
        removed: 0
      });
      assert.equal(summary.enrichment.status, "skipped");
      assert.match(summary.enrichment.reason, /ollama exploded/);
      assert.equal(summary.enrichment.suggestionsInserted, 0);
      // The report still landed, and says so.
      assert.ok(summary.report && existsSync(summary.report));
      const report = readFileSync(summary.report, "utf8");
      assert.match(report, /Skipped: .*ollama exploded/);
      assert.match(report, /migration itself completed normally/);
      // A migrate activity row exists — the timeline knows this run happened.
      const { rows } = await adapter.query(
        "SELECT count(*)::int AS n FROM activity WHERE kind = 'migrate'"
      );
      assert.equal(rows[0].n, 1);
    } finally {
      await adapter.close();
      rmSync(vault, { recursive: true, force: true });
      rmSync(dataRoot, { recursive: true, force: true });
    }
  }
);

test(
  "timeline: default is NEWEST first; sinceId switches to ascending id > sinceId",
  { skip },
  async () => {
    const s = await bootService({ initialSync: false }); // no sync rows: activity ids start at 1
    try {
      const adapter = s.service.getAdapter();
      for (let i = 1; i <= 30; i += 1) {
        await adapter.query(
          "INSERT INTO activity(kind, path, detail) VALUES ('note_upsert', $1, '{}'::jsonb)",
          [`n${i}.md`]
        );
      }
      const headers = { "x-vkm-pg-token": s.token };

      const recent = await fetch(`${s.base}/api/timeline?limit=5`, { headers });
      assert.equal(recent.status, 200);
      const recentIds = (await recent.json()).events.map((e) => e.id);
      assert.deepEqual(
        recentIds,
        [30, 29, 28, 27, 26],
        "no sinceId means the 5 NEWEST, descending"
      );

      const after = await fetch(`${s.base}/api/timeline?sinceId=10&limit=5`, { headers });
      assert.equal(after.status, 200);
      const afterIds = (await after.json()).events.map((e) => e.id);
      assert.deepEqual(afterIds, [11, 12, 13, 14, 15], "sinceId=10 means ascending ids > 10");
    } finally {
      await s.cleanup();
    }
  }
);

test("double boot: a live lock refuses start() BEFORE the datadir is opened", async () => {
  const vault = mkdtempSync(join(tmpdir(), "vkm-pg-vault-"));
  const dataRoot = mkdtempSync(join(tmpdir(), "vkm-pg-data-"));
  const env = { VKM_PG_MEMORY: "1", VKM_PG_DATA_ROOT: dataRoot };
  const dir = vaultPgDir(vault, env);
  mkdirSync(dir, { recursive: true });
  // Simulate the winning sibling: a lock naming a live pid (our own).
  writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, port: 1 }), "utf8");
  let opened = 0;
  const service = createService({
    vaultAbs: vault,
    env,
    watch: false,
    deps: {
      openAdapter: async () => {
        opened += 1;
        throw new Error("openAdapter must not be reached when the lock is held");
      }
    }
  });
  try {
    await assert.rejects(service.start(), AlreadyRunningError);
    await assert.rejects(service.start(), /already running/);
    assert.equal(opened, 0, "the mutex is taken before openAdapter — PGlite is single-writer");
    // The loser leaves the winner's lock untouched and writes no service.json.
    assert.deepEqual(JSON.parse(readFileSync(lockPath(dir), "utf8")), {
      pid: process.pid,
      port: 1
    });
    assert.ok(!existsSync(serviceInfoPath(dir)));
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("stale lock (dead pid) is swept once and boot proceeds", { skip }, async () => {
  const vault = mkdtempSync(join(tmpdir(), "vkm-pg-vault-"));
  const dataRoot = mkdtempSync(join(tmpdir(), "vkm-pg-data-"));
  const env = { VKM_PG_MEMORY: "1", VKM_PG_DATA_ROOT: dataRoot };
  const dir = vaultPgDir(vault, env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(lockPath(dir), JSON.stringify({ pid: await spawnDeadPid(), port: 1 }), "utf8");
  const service = createService({
    vaultAbs: vault,
    env,
    watch: false,
    initialSync: false,
    deps: { runDump: async () => makeDump() }
  });
  try {
    const port = await service.start();
    assert.ok(port > 0);
    assert.deepEqual(JSON.parse(readFileSync(lockPath(dir), "utf8")), {
      pid: process.pid,
      port
    });
  } finally {
    await service.stop();
    rmSync(vault, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("POST body over 1 MiB is answered 413", { skip }, async () => {
  const s = await bootService({ initialSync: false });
  try {
    const big = `{"q":"${"x".repeat(1024 * 1024 + 64 * 1024)}"}`;
    const { status, body } = await new Promise((res, rej) => {
      const req = http.request(
        `${s.base}/api/search`,
        {
          method: "POST",
          headers: {
            "x-vkm-pg-token": s.token,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(big)
          }
        },
        (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (c) => (raw += c));
          response.on("end", () => res({ status: response.statusCode, body: raw }));
          // The server resets the upload after answering — expected, not a failure,
          // as long as the 413 arrived first.
          response.on("error", () => res({ status: response.statusCode, body: raw }));
        }
      );
      req.on("error", rej);
      req.end(big);
    });
    assert.equal(status, 413);
    assert.match(JSON.parse(body).error, /body exceeds/);
  } finally {
    await s.cleanup();
  }
});

test("ensureServiceRunning: stale service.json (dead pid) is unlinked, then it spawns", async () => {
  const vault = mkdtempSync(join(tmpdir(), "vkm-pg-vault-"));
  const dataRoot = mkdtempSync(join(tmpdir(), "vkm-pg-data-"));
  const env = { VKM_PG_DATA_ROOT: dataRoot };
  const dir = vaultPgDir(vault, env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    serviceInfoPath(dir),
    JSON.stringify({ port: 1, pid: await spawnDeadPid(), vault, version: "0.0.0" }),
    "utf8"
  );
  /** @type {{ cmd: string, args: string[] }[]} */
  const spawned = [];
  const fakeSpawn = (cmd, args) => {
    spawned.push({ cmd, args });
    return { on() {}, unref() {} };
  };
  try {
    const ok = await ensureServiceRunning({
      vaultAbs: vault,
      env,
      deps: { spawn: fakeSpawn, deadlineMs: 0 }
    });
    assert.equal(ok, false, "deadlineMs 0 + a fake child: nothing can come up");
    assert.ok(!existsSync(serviceInfoPath(dir)), "stale service.json unlinked before the spawn");
    assert.equal(spawned.length, 1, "the spawn still happened");
    const flat = [spawned[0].cmd, ...spawned[0].args].join(" ");
    assert.match(flat, /pg-service\.mjs/);
    assert.ok(flat.includes(resolvePath(vault)), "child gets the resolved vault path");
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("ensureServiceRunning accepts the { vault } alias (frozen sidecar seam)", async () => {
  const vault = mkdtempSync(join(tmpdir(), "vkm-pg-vault-"));
  const dataRoot = mkdtempSync(join(tmpdir(), "vkm-pg-data-"));
  const env = { VKM_PG_DATA_ROOT: dataRoot };
  const spawned = [];
  const fakeSpawn = (cmd, args) => {
    spawned.push({ cmd, args });
    return { on() {}, unref() {} };
  };
  try {
    const ok = await ensureServiceRunning({
      vault,
      env,
      deps: { spawn: fakeSpawn, deadlineMs: 0 }
    });
    assert.equal(ok, false);
    assert.equal(spawned.length, 1, "alias reaches the same spawn path as vaultAbs");
    assert.ok([spawned[0].cmd, ...spawned[0].args].join(" ").includes(resolvePath(vault)));
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("scope contract: validation matrix and segment-boundary matching", () => {
  const good = [
    "PROJECTS",
    "PROJECTS/vkm-kit",
    "AGENTS/vkm-implementer",
    "a b/c-d_e",
    "ñoño/sección"
  ];
  for (const s of good) assert.equal(isValidScope(s), true, s);
  const bad = ["", "..", "a/../b", "PROJECTS/..", "/PROJECTS", "C:/vault", "c:x", "a\\b", "\\\\x"];
  for (const s of bad) assert.equal(isValidScope(s), false, JSON.stringify(s));

  assert.equal(pathInScope("PROJECTS/vkm-kit", "PROJECTS/vkm-kit"), true, "P == S");
  assert.equal(pathInScope("PROJECTS/vkm-kit.md", "PROJECTS/vkm-kit"), true, "P == S + '.md'");
  assert.equal(pathInScope("PROJECTS/vkm-kit/notes.md", "PROJECTS/vkm-kit"), true, "P under S/");
  assert.equal(pathInScope("PROJECTS/vkm-kit2.md", "PROJECTS/vkm-kit"), false, "segment boundary");
  assert.equal(pathInScope("projects/vkm-kit.md", "PROJECTS/vkm-kit"), false, "case-sensitive");
  assert.equal(pathInScope("AGENTS/x.md", "PROJECTS"), false, "different namespace");
});

test("scope SQL starts_with: underscore and percent are literal, not LIKE wildcards", { skip }, async () => {
  // Regression: LIKE $scope || '/%' treated `_`/`%` in the scope as wildcards and diverged
  // from pathInScope. starts_with keeps the SQL arm literal (AGENTS/fo_o must not match foXo).
  const { scopeMatchSql } = await import("../src/scope.mjs");
  const s = await bootService({ initialSync: false });
  const adapter = s.service.getAdapter();
  assert.ok(adapter, "service adapter open");
  try {
    // Include children under foXo/fo%o so the third arm (prefix/) is exercised: with LIKE,
    // scope AGENTS/fo_o would wrongly match AGENTS/foXo/child.md via `_` → any char.
    for (const p of [
      "AGENTS/fo_o.md",
      "AGENTS/foXo.md",
      "AGENTS/fo%o.md",
      "AGENTS/foXo/child.md",
      "AGENTS/fo%o/child.md",
      "AGENTS/fo_o/child.md"
    ]) {
      await adapter.query(
        "INSERT INTO notes(path, title, mtime_ns, size_b, folder, body_fold) VALUES ($1, $2, 1, 0, split_part($1, '/', 1), '')",
        [p, p]
      );
    }
    const pathsFor = async (scope) => {
      const { rows } = await adapter.query(
        `SELECT path FROM notes WHERE ${scopeMatchSql("path", 1)} ORDER BY path`,
        [scope]
      );
      return rows.map((r) => String(r.path));
    };
    assert.deepEqual(await pathsFor("AGENTS/fo_o"), ["AGENTS/fo_o.md", "AGENTS/fo_o/child.md"]);
    assert.deepEqual(await pathsFor("AGENTS/fo%o"), ["AGENTS/fo%o.md", "AGENTS/fo%o/child.md"]);
    assert.deepEqual(await pathsFor("AGENTS/foXo"), ["AGENTS/foXo.md", "AGENTS/foXo/child.md"]);
  } finally {
    await s.cleanup();
  }
});

test("scoped search: fts and vector exclude out-of-scope notes", { skip }, async () => {
  // The fixture embeds alpha's chunk at [1,0,...]; the fake query embedding matches it
  // exactly, so unscoped vector order is deterministic: alpha first, gamma second.
  const s = await bootService({
    deps: { embedQuery: async () => ({ vec_b64: vecB64([1, 0, 0, 0, 0, 0, 0, 0]) }) }
  });
  try {
    const post = async (body) => {
      const res = await fetch(`${s.base}/api/search`, {
        method: "POST",
        headers: { "x-vkm-pg-token": s.token, "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      assert.equal(res.status, 200);
      return res.json();
    };

    const all = await post({ q: "beta" });
    assert.deepEqual(
      all.hits.map((h) => h.path).sort(),
      ["PRACTICES/beta.md", "PROJECTS/alpha.md"],
      "unscoped fts sees both notes mentioning beta"
    );
    const practices = await post({ q: "beta", scope: "PRACTICES" });
    assert.deepEqual(
      practices.hits.map((h) => h.path),
      ["PRACTICES/beta.md"]
    );
    // A scope naming the note itself (no `.md`) matches via the S + ".md" arm.
    const single = await post({ q: "beta", scope: "PROJECTS/alpha" });
    assert.deepEqual(
      single.hits.map((h) => h.path),
      ["PROJECTS/alpha.md"]
    );

    const vecAll = await post({ q: "anything", mode: "vector" });
    assert.deepEqual(
      vecAll.hits.map((h) => h.path),
      ["PROJECTS/alpha.md", "gamma.md"]
    );
    const vecScoped = await post({ q: "anything", mode: "vector", scope: "gamma" });
    assert.deepEqual(
      vecScoped.hits.map((h) => h.path),
      ["gamma.md"]
    );
  } finally {
    await s.cleanup();
  }
});

test("scoped graph: seed and traversed edges never leave the scope", { skip }, async () => {
  const s = await bootService({ initialSync: false });
  try {
    const adapter = s.service.getAdapter();
    for (const [p, t] of [
      ["AGENTS/a.md", "A"],
      ["AGENTS/b.md", "B"],
      ["OTHER/c.md", "C"]
    ]) {
      await adapter.query(
        "INSERT INTO notes(path, title, mtime_ns, size_b, folder, body_fold) VALUES ($1, $2, 1, 0, split_part($1, '/', 1), '')",
        [p, t]
      );
    }
    for (const [source, target] of [
      ["AGENTS/a.md", "agents/b"],
      ["AGENTS/a.md", "other/c"],
      ["OTHER/c.md", "agents/a"]
    ]) {
      await adapter.query(
        "INSERT INTO relations(source_path, relation_type, target, context) VALUES ($1, 'relates_to', $2, '')",
        [source, target]
      );
    }
    const headers = { "x-vkm-pg-token": s.token };
    const get = async (qs) => {
      const res = await fetch(`${s.base}/api/graph?${qs}`, { headers });
      assert.equal(res.status, 200);
      return res.json();
    };

    const open = await get("from=AGENTS%2Fa.md&depth=2");
    assert.ok(
      open.edges.some((e) => e.source === "OTHER/c.md" || e.target === "OTHER/c.md"),
      "unscoped traversal crosses namespaces"
    );

    const scoped = await get("from=AGENTS%2Fa.md&depth=2&scope=AGENTS");
    assert.deepEqual(scoped.edges, [
      { source: "AGENTS/a.md", type: "relates_to", target: "AGENTS/b.md", depth: 1 }
    ]);
    assert.deepEqual(
      scoped.nodes.map((n) => n.path),
      ["AGENTS/a.md", "AGENTS/b.md"]
    );
    for (const n of scoped.nodes) assert.ok(pathInScope(n.path, "AGENTS"));

    // An out-of-scope seed reaches nothing — and is not leaked as a node either.
    const foreign = await get("from=OTHER%2Fc.md&depth=2&scope=AGENTS");
    assert.deepEqual(foreign, { nodes: [], edges: [] });

    // Full graph (no from): only the edge with BOTH endpoints inside AGENTS survives.
    const full = await get("scope=AGENTS");
    assert.deepEqual(
      full.edges.map((e) => [e.source, e.target]),
      [["AGENTS/a.md", "AGENTS/b.md"]]
    );
  } finally {
    await s.cleanup();
  }
});

test(
  "scoped timeline: both branches filter by path; sync rows only unscoped",
  { skip },
  async () => {
    const s = await bootService({ initialSync: false });
    try {
      const adapter = s.service.getAdapter();
      for (const [kind, p] of [
        ["note_upsert", "PROJECTS/x.md"],
        ["note_upsert", "AGENTS/y.md"],
        ["sync", null]
      ]) {
        await adapter.query(
          "INSERT INTO activity(kind, path, detail) VALUES ($1, $2, '{}'::jsonb)",
          [kind, p]
        );
      }
      const headers = { "x-vkm-pg-token": s.token };
      const events = async (qs) => {
        const res = await fetch(`${s.base}/api/timeline${qs}`, { headers });
        assert.equal(res.status, 200);
        return (await res.json()).events;
      };

      const all = await events("");
      assert.deepEqual(
        all.map((e) => e.kind),
        ["sync", "note_upsert", "note_upsert"],
        "unscoped: NULL-path sync rows pass"
      );

      const scoped = await events("?scope=PROJECTS");
      assert.deepEqual(
        scoped.map((e) => [e.kind, e.path]),
        [["note_upsert", "PROJECTS/x.md"]],
        "scoped: out-of-scope paths AND NULL-path sync rows drop"
      );

      const ascending = await events("?scope=PROJECTS&sinceId=0");
      assert.deepEqual(
        ascending.map((e) => e.path),
        ["PROJECTS/x.md"],
        "scope also applies to the sinceId (ascending) branch"
      );
    } finally {
      await s.cleanup();
    }
  }
);

test("suggestions: scope filters pending rows like timeline", { skip }, async () => {
  const s = await bootService({ initialSync: false });
  const adapter = s.service.getAdapter();
  assert.ok(adapter);
  try {
    for (const p of ["PROJECTS/a.md", "PRACTICES/b.md"]) {
      await adapter.query(
        "INSERT INTO suggestions(path, kind, payload, status) VALUES ($1, 'relation', '{}'::jsonb, 'pending')",
        [p]
      );
    }
    const headers = { "x-vkm-pg-token": s.token };
    const list = async (qs) => {
      const res = await fetch(`${s.base}/api/suggestions${qs}`, { headers });
      assert.equal(res.status, 200);
      return (await res.json()).suggestions.map((row) => row.path).sort();
    };
    assert.deepEqual(await list(""), ["PRACTICES/b.md", "PROJECTS/a.md"]);
    assert.deepEqual(await list("?scope=PROJECTS"), ["PROJECTS/a.md"]);
  } finally {
    await s.cleanup();
  }
});

test("invalid scope answers 400 on every endpoint; stats honors scope", { skip }, async () => {
  const s = await bootService();
  try {
    const headers = { "x-vkm-pg-token": s.token };
    for (const scope of ["..", "a/../b", "/abs", "C:/vault", "a\\b"]) {
      for (const route of ["/api/timeline", "/api/stats", "/api/graph", "/api/suggestions"]) {
        const res = await fetch(`${s.base}${route}?scope=${encodeURIComponent(scope)}`, {
          headers
        });
        assert.equal(res.status, 400, `${route} scope=${scope}`);
        assert.deepEqual(await res.json(), { error: "invalid scope" });
      }
      const search = await fetch(`${s.base}/api/search`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ q: "beta", scope })
      });
      assert.equal(search.status, 400, `search scope=${scope}`);
      assert.deepEqual(await search.json(), { error: "invalid scope" });
    }
    // Non-string scope in the search body is invalid too, never coerced.
    const numeric = await fetch(`${s.base}/api/search`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ q: "beta", scope: 42 })
    });
    assert.equal(numeric.status, 400);
    assert.deepEqual(await numeric.json(), { error: "invalid scope" });

    // Optional scope on /api/stats narrows every aggregate to the namespace.
    const stats = await (await fetch(`${s.base}/api/stats?scope=PROJECTS`, { headers })).json();
    assert.deepEqual(stats.notesByFolder, [["PROJECTS", 1]]);
    assert.equal(stats.chunkCount, 1, "only PROJECTS/alpha.md's chunk");
    assert.deepEqual(stats.observationsByCategory, [], "gamma.md's observation is out of scope");
    assert.deepEqual(stats.relationsByType, [["implements", 1]]);
    assert.deepEqual(stats.topTags, []);
  } finally {
    await s.cleanup();
  }
});

test("migrate --dry-run executes nothing and reports the plan", { skip }, async () => {
  const vault = mkdtempSync(join(tmpdir(), "vkm-pg-dry-vault-"));
  const dataRoot = mkdtempSync(join(tmpdir(), "vkm-pg-dry-data-"));
  const env = { VKM_PG_MEMORY: "1", VKM_PG_DATA_ROOT: dataRoot };
  try {
    let dumped = false;
    const summary = await runMigrate(
      { vaultAbs: vault, env, dryRun: true, rebuild: true },
      {
        runDump: async () => {
          dumped = true;
          return makeDump();
        }
      }
    );
    assert.equal(summary.ok, true);
    assert.equal(summary.dryRun, true);
    assert.equal(summary.wouldRebuild, true);
    assert.equal(dumped, false, "dry-run must not shell the dumper");
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
