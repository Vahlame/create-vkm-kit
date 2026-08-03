/**
 * migrate.mjs unit tests — everything DI'd: fake adapters record SQL, fake runDump feeds
 * handcrafted dumps, fake Ollama drivers script the enrichment path. No Python, no real
 * Ollama, no on-disk PGlite; the only real filesystem use is temp dirs for the projection
 * home (VKM_PG_DATA_ROOT) and small vault fixtures for enrichPass.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runMigrate,
  enrichPass,
  isInsideVault,
  defaultConfirm,
  HELP_TEXT
} from "../src/migrate.mjs";
import { vaultPgDir, dataDirPath, serviceInfoPath } from "../src/pg-paths.mjs";

const MIGRATE_HREF = new URL("../src/migrate.mjs", import.meta.url).href;
const MIGRATE_SRC = new URL("../src/migrate.mjs", import.meta.url);

test("direct-path syncFromDump is wired with runDump/vaultAbs (escalation opts)", () => {
  const src = fs.readFileSync(MIGRATE_SRC, "utf8");
  assert.match(
    src,
    /syncFromDump\(\s*adapter,\s*dump,\s*\{\s*vaultAbs,\s*env,\s*runDump:\s*doDump\s*\}/,
    "CLI migrate must pass the same escalation opts the pg-service uses"
  );
});

function makeTmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Minimal-but-valid schema-1 dump wire object: empty vault. syncFromDump applies it as a
 * no-op sync (nothing inserted, nothing removed, cursor 0).
 */
function emptyDump() {
  return {
    schema: 1,
    embedder: "test-embedder",
    dim: 8,
    manifest: [],
    notes: [],
    chunks: [],
    relations: [],
    observations: [],
    count: { notes: 0, chunks: 0, relations: 0, observations: 0 }
  };
}

/**
 * Recording fake adapter. `onQuery`/`onExec` may throw or return a row set to script a
 * scenario; the default answers cover everything runMigrate's direct path asks for.
 */
function makeFakeAdapter({ backend = "pglite", onQuery, onExec } = {}) {
  const calls = { exec: [], query: [], closed: 0 };
  const adapter = {
    backend,
    capabilities: { vector: false, notify: true },
    exec: async (sql) => {
      calls.exec.push(sql);
      if (onExec) await onExec(sql);
    },
    query: async (sql, params = []) => {
      calls.query.push({ sql, params });
      if (onQuery) {
        const scripted = await onQuery(sql, params);
        if (scripted !== undefined) return scripted;
      }
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
      return { rows: [] };
    },
    listen: async () => async () => {},
    notify: async () => {},
    close: async () => {
      calls.closed += 1;
    }
  };
  return { adapter, calls };
}

/** A scripted Ollama driver: always-healthy check, `chat` delegates to `reply`. */
function makeOllama(reply) {
  const chats = [];
  return {
    chats,
    driver: {
      check: async () => ({ ok: true, reason: null }),
      chat: async (args) => {
        chats.push(args);
        return reply(args);
      }
    }
  };
}

// ---------------------------------------------------------------------------- HELP_TEXT

test("HELP_TEXT documents the DSN --rebuild semantics (TRUNCATE + forced full)", () => {
  assert.match(HELP_TEXT, /--rebuild/);
  assert.match(HELP_TEXT, /VKM_PG_DSN/);
  assert.match(HELP_TEXT, /TRUNCATE/);
  assert.match(HELP_TEXT, /full resync/);
});

// ------------------------------------------------------------------- [17] containment

test("isInsideVault: normal vault accepts members, rejects escapes", (t) => {
  const vault = makeTmp(t, "vkm-mig-contain-");
  const root = path.resolve(vault);
  assert.equal(isInsideVault(root, path.resolve(root, "a.md")), true);
  assert.equal(isInsideVault(root, path.resolve(root, "PROJECTS", "b.md")), true);
  assert.equal(isInsideVault(root, root), true);
  assert.equal(isInsideVault(root, path.resolve(root, "..", "evil.md")), false);
});

test("isInsideVault: filesystem-root vault does not reject every note", () => {
  // path.resolve keeps the trailing separator on roots ("C:\\", "/"); the naive
  // `root + path.sep` prefix used to reject every real path under a root-mounted vault.
  const fsRoot = path.parse(process.cwd()).root;
  assert.equal(fsRoot.endsWith(path.sep), true); // the premise of the regression
  assert.equal(isInsideVault(fsRoot, path.join(fsRoot, "note.md")), true);
  assert.equal(isInsideVault(fsRoot, path.join(fsRoot, "PROJECTS", "x.md")), true);
  assert.equal(isInsideVault(fsRoot, fsRoot), true);
});

test("enrichPass: escaped projection paths are skipped without reading or chatting", async (t) => {
  const base = makeTmp(t, "vkm-mig-enrich-");
  const vault = path.join(base, "vault");
  fs.mkdirSync(vault);
  fs.writeFileSync(path.join(vault, "inside.md"), "# inside\nbody", "utf8");
  fs.writeFileSync(path.join(base, "escape.md"), "# outside\nbody", "utf8");

  const { adapter } = makeFakeAdapter({
    onQuery: (sql) => {
      if (/FROM notes n/.test(sql)) {
        return { rows: [{ path: "inside.md" }, { path: "../escape.md" }] };
      }
      return undefined;
    }
  });
  const { driver, chats } = makeOllama(() => ({ relations: [], observations: [] }));

  const res = await enrichPass(adapter, { vaultAbs: vault, cap: 10, model: "m", ollama: driver });
  assert.equal(res.status, "done");
  assert.equal(res.notesConsidered, 2);
  assert.equal(chats.length, 1); // the escape row never reached Ollama
  assert.match(chats[0].user, /inside\.md/);
});

// -------------------------------------------------------------- [15] suggestion dedupe

test("enrichPass: candidate query excludes notes with pending suggestions", async (t) => {
  const vault = makeTmp(t, "vkm-mig-dedupe-");
  let candidateSql = null;
  const { adapter } = makeFakeAdapter({
    onQuery: (sql) => {
      if (/FROM notes n/.test(sql)) {
        candidateSql = sql;
        return { rows: [] };
      }
      return undefined;
    }
  });
  const { driver } = makeOllama(() => ({ relations: [], observations: [] }));

  const res = await enrichPass(adapter, { vaultAbs: vault, cap: 5, model: "m", ollama: driver });
  assert.equal(res.status, "done");
  assert.ok(candidateSql, "candidate SELECT never issued");
  assert.match(candidateSql, /NOT EXISTS \(SELECT 1 FROM suggestions s/);
  assert.match(candidateSql, /s\.path = n\.path AND s\.status = 'pending'/);
});

// --------------------------------------------------------- [13] guarded INSERT failures

test("enrichPass: a failing suggestion INSERT skips with a reason instead of throwing", async (t) => {
  const vault = makeTmp(t, "vkm-mig-insfail-");
  fs.writeFileSync(path.join(vault, "a.md"), "# a", "utf8");
  const { adapter } = makeFakeAdapter({
    onQuery: (sql) => {
      if (/FROM notes n/.test(sql)) return { rows: [{ path: "a.md" }] };
      if (/INSERT INTO suggestions/.test(sql)) throw new Error("boom: disk full");
      return undefined;
    }
  });
  const { driver } = makeOllama(() => ({
    relations: [{ verb: "implements", target: "x" }],
    observations: []
  }));

  const res = await enrichPass(adapter, { vaultAbs: vault, cap: 5, model: "m", ollama: driver });
  assert.equal(res.status, "skipped");
  assert.match(res.reason, /suggestion insert failed: boom: disk full/);
  assert.equal(res.notesConsidered, 1);
  assert.equal(res.suggestionsInserted, 0);
});

test("enrichPass: partial insert failure preserves the count of committed inserts", async (t) => {
  const vault = makeTmp(t, "vkm-mig-inspart-");
  fs.writeFileSync(path.join(vault, "a.md"), "# a", "utf8");
  let suggestionInserts = 0;
  const { adapter } = makeFakeAdapter({
    onQuery: (sql) => {
      if (/FROM notes n/.test(sql)) return { rows: [{ path: "a.md" }] };
      if (/INSERT INTO suggestions/.test(sql)) {
        suggestionInserts += 1;
        if (suggestionInserts === 2) throw new Error("second insert fails");
      }
      return undefined;
    }
  });
  const { driver } = makeOllama(() => ({
    relations: [{ verb: "implements", target: "x" }],
    observations: [{ category: "fact", content: "y", tags: [] }]
  }));

  const res = await enrichPass(adapter, { vaultAbs: vault, cap: 5, model: "m", ollama: driver });
  assert.equal(res.status, "skipped");
  assert.match(res.reason, /suggestion insert failed/);
  assert.equal(res.suggestionsInserted, 1); // the relations insert had already landed
});

// ------------------------------------------------------------------ [12] rebuild TOCTOU

test("runMigrate --rebuild refuses when a live service exists at entry", async (t) => {
  const root = makeTmp(t, "vkm-mig-svc-");
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const env = { VKM_PG_DATA_ROOT: path.join(root, "pg") };
  const dir = vaultPgDir(vault, env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(serviceInfoPath(dir), JSON.stringify({ pid: process.pid, port: 1234 }), "utf8");

  let opened = 0;
  await assert.rejects(
    runMigrate(
      { vaultAbs: vault, env, rebuild: true, yes: true, report: false },
      {
        openAdapter: async () => {
          opened += 1;
          throw new Error("must not open");
        },
        runDump: async () => emptyDump()
      }
    ),
    /--rebuild refused: a pg-service is running/
  );
  assert.equal(opened, 0);
});

test("runMigrate --rebuild: service appearing DURING the confirm prompt blocks rmSync", async (t) => {
  const root = makeTmp(t, "vkm-mig-toctou-rm-");
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const env = { VKM_PG_DATA_ROOT: path.join(root, "pg") };
  const dir = vaultPgDir(vault, env);
  const dataDir = dataDirPath(dir);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "marker.bin"), "projection bytes", "utf8");

  let opened = 0;
  await assert.rejects(
    runMigrate(
      {
        vaultAbs: vault,
        env,
        rebuild: true,
        report: false,
        // The prompt is the unbounded window: a service boots while it sits open.
        confirm: async () => {
          fs.writeFileSync(
            serviceInfoPath(dir),
            JSON.stringify({ pid: process.pid, port: 4321 }),
            "utf8"
          );
          return true; // the user says yes — the re-check must still win
        }
      },
      {
        openAdapter: async () => {
          opened += 1;
          throw new Error("must not open");
        },
        runDump: async () => emptyDump()
      }
    ),
    /--rebuild refused: a pg-service is running .*pid \d+, port 4321/
  );
  assert.equal(opened, 0);
  assert.ok(fs.existsSync(path.join(dataDir, "marker.bin")), "datadir must survive the refusal");
});

test("runMigrate --rebuild (DSN): service appearing during confirm blocks openAdapter", async (t) => {
  const root = makeTmp(t, "vkm-mig-toctou-open-");
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const env = { VKM_PG_DATA_ROOT: path.join(root, "pg"), VKM_PG_DSN: "postgres://x/y" };
  const dir = vaultPgDir(vault, env);

  let opened = 0;
  await assert.rejects(
    runMigrate(
      {
        vaultAbs: vault,
        env,
        rebuild: true,
        report: false,
        confirm: async () => {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            serviceInfoPath(dir),
            JSON.stringify({ pid: process.pid, port: 9999 }),
            "utf8"
          );
          return true;
        }
      },
      {
        openAdapter: async () => {
          opened += 1;
          throw new Error("must not open");
        },
        runDump: async () => emptyDump()
      }
    ),
    /--rebuild refused: a pg-service is running/
  );
  assert.equal(opened, 0);
});

// -------------------------------------------------------------- [16] --rebuild on a DSN

test("runMigrate --rebuild (DSN): transactional TRUNCATE + cursor delete, forced full", async (t) => {
  const root = makeTmp(t, "vkm-mig-dsn-");
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const env = { VKM_PG_DATA_ROOT: path.join(root, "pg"), VKM_PG_DSN: "postgres://x/y" };
  const dataDir = dataDirPath(vaultPgDir(vault, env));
  fs.mkdirSync(dataDir, { recursive: true }); // a stale local datadir must NOT be deleted

  const { adapter, calls } = makeFakeAdapter({ backend: "dsn" });
  const dumps = [];
  const summary = await runMigrate(
    { vaultAbs: vault, env, rebuild: true, yes: true, report: false },
    {
      openAdapter: async () => adapter,
      runDump: async (opts) => {
        dumps.push(opts);
        return emptyDump();
      }
    }
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.rebuild, true);
  assert.equal(summary.mode, "full"); // truncated tables demand a full resync
  assert.equal(summary.via, "direct");

  const ti = calls.exec.findIndex((s) => s.startsWith("TRUNCATE TABLE"));
  assert.ok(ti > 0, "no TRUNCATE issued");
  for (const table of ["notes", "chunks", "relations", "observations", "activity", "suggestions"]) {
    assert.match(calls.exec[ti], new RegExp(`\\b${table}\\b`));
  }
  assert.equal(calls.exec[ti - 1], "BEGIN");
  assert.equal(calls.exec[ti + 1], "COMMIT");
  assert.ok(
    calls.query.some(
      (c) => /DELETE FROM meta WHERE key = \$1/.test(c.sql) && c.params[0] === "cursor_mtime_ns"
    ),
    "cursor meta row not deleted"
  );
  assert.equal(dumps.length, 1);
  assert.equal(dumps[0].sinceMtimeNs, null); // full mode ignores the cursor
  assert.ok(fs.existsSync(dataDir), "DSN rebuild must not touch the local datadir");
  assert.equal(calls.closed, 1); // runMigrate owned the adapter it opened
});

test("runMigrate --rebuild (DSN): TRUNCATE failure rolls back and propagates", async (t) => {
  const root = makeTmp(t, "vkm-mig-dsnfail-");
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const env = { VKM_PG_DATA_ROOT: path.join(root, "pg"), VKM_PG_DSN: "postgres://x/y" };

  const { adapter, calls } = makeFakeAdapter({
    backend: "dsn",
    onExec: (sql) => {
      if (sql.startsWith("TRUNCATE")) throw new Error("trunc-fail");
    }
  });
  await assert.rejects(
    runMigrate(
      { vaultAbs: vault, env, rebuild: true, yes: true, report: false },
      { openAdapter: async () => adapter, runDump: async () => emptyDump() }
    ),
    /trunc-fail/
  );
  assert.ok(calls.exec.includes("ROLLBACK"), "failed TRUNCATE transaction must roll back");
});

test("runMigrate --rebuild (DSN): declined confirm aborts before anything opens", async (t) => {
  const root = makeTmp(t, "vkm-mig-dsnno-");
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const env = { VKM_PG_DATA_ROOT: path.join(root, "pg"), VKM_PG_DSN: "postgres://x/y" };

  let opened = 0;
  await assert.rejects(
    runMigrate(
      { vaultAbs: vault, env, rebuild: true, report: false, confirm: async () => false },
      {
        openAdapter: async () => {
          opened += 1;
          throw new Error("must not open");
        },
        runDump: async () => emptyDump()
      }
    ),
    /--rebuild aborted: not confirmed/
  );
  assert.equal(opened, 0);
});

test("runMigrate --rebuild (PGlite): deletes the datadir and resyncs, no TRUNCATE", async (t) => {
  const root = makeTmp(t, "vkm-mig-pglite-");
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const env = { VKM_PG_DATA_ROOT: path.join(root, "pg") };
  const dataDir = dataDirPath(vaultPgDir(vault, env));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "marker.bin"), "old projection", "utf8");

  const { adapter, calls } = makeFakeAdapter({ backend: "pglite" });
  const summary = await runMigrate(
    { vaultAbs: vault, env, rebuild: true, yes: true, report: false },
    { openAdapter: async () => adapter, runDump: async () => emptyDump() }
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.rebuild, true);
  assert.equal(fs.existsSync(dataDir), false, "datadir must be deleted");
  assert.ok(!calls.exec.some((s) => s.startsWith("TRUNCATE")), "no TRUNCATE on PGlite");
});

// ------------------------------------------------------------- [14] confirm via stderr

test("defaultConfirm: non-TTY stdin answers no without prompting", async () => {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  process.stdin.isTTY = false;
  try {
    assert.equal(await defaultConfirm("should not hang? "), false);
  } finally {
    if (original) Object.defineProperty(process.stdin, "isTTY", original);
    else delete process.stdin.isTTY;
  }
});

test("defaultConfirm: prompt goes to stderr, never stdout", async () => {
  // Child process: fake a TTY stdin flag, answer "y" through the pipe, and observe which
  // stream carries the question. stdout must stay clean — it is the --json channel.
  const script = [
    "process.stdin.isTTY = true;",
    `import(${JSON.stringify(MIGRATE_HREF)}).then(async (m) => {`,
    '  const ok = await m.defaultConfirm("CONFIRM_TOKEN? ");',
    '  console.log("ANSWER:" + ok);',
    '}).catch((e) => { console.error("CHILD_ERR:" + (e && e.message)); process.exit(2); });'
  ].join("\n");

  const child = spawn(process.execPath, ["-e", script], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => {
    out += String(d);
  });
  child.stderr.on("data", (d) => {
    err += String(d);
  });
  child.stdin.write("y\n");
  child.stdin.end();
  const code = await new Promise((resolve) => child.on("close", resolve));

  assert.equal(code, 0, `child failed: ${err}`);
  assert.match(out, /ANSWER:true/);
  assert.ok(!out.includes("CONFIRM_TOKEN"), "prompt leaked to stdout");
  assert.ok(err.includes("CONFIRM_TOKEN"), "prompt missing from stderr");
});
