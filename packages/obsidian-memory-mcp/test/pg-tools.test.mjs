/**
 * Pure-helper tests for the Postgres-projection tool logic (pg-tools.mjs).
 * No network; every seam (env, fetch, module loaders) is injected for the
 * behavior tests. The final "seam pin" tests are the one exception: they import
 * the REAL @vkmikc/vkm-memory-pg subpaths to pin the frozen exports
 * (vaultPgDir / ensureServiceRunning) against the actual sibling package, so
 * the DI fakes cannot drift from reality. The wire-level registration of the
 * three tools is covered in hybrid-mcp.test.mjs; this file pins the logic
 * those handlers delegate to — above all that the DISABLED path answers with
 * the how-to-enable message and never touches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pgEnabled,
  disabledMessage,
  formatStatus,
  buildGraphParams,
  validateScope,
  pgStatus,
  pgGraph,
  pgTimeline
} from "../src/pg-tools.mjs";

/** A minimal fetch-Response stand-in (only the members apiGet touches). */
function fakeResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

/** Records every call; answers each from `responses` in order. */
function fetchSpy(...responses) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (!responses.length) throw new Error("fetch spy exhausted");
    return responses.shift();
  };
  impl.calls = calls;
  return impl;
}

/** A service dir with the frozen on-disk contract files. */
function makeServiceDir({ port = 45999, pid = process.pid, token = "tok123" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pg-tools-svc-"));
  writeFileSync(
    join(dir, "service.json"),
    JSON.stringify({ port, pid, vault: "x", version: "5.4.0", startedAt: "now" }),
    "utf8"
  );
  writeFileSync(join(dir, "service.token"), `${token}\n`, "utf8");
  return dir;
}

const loadPathsFor = (dir) => async () => ({ vaultPgDir: () => dir });

// ── pgEnabled ────────────────────────────────────────────────────────────────

test("pgEnabled: VKM_PG === '1' or a non-empty VKM_PG_DSN — nothing else", () => {
  assert.equal(pgEnabled({}), false);
  assert.equal(pgEnabled({ VKM_PG: "0" }), false);
  assert.equal(pgEnabled({ VKM_PG: "true" }), false);
  assert.equal(pgEnabled({ VKM_PG: "1" }), true);
  assert.equal(pgEnabled({ VKM_PG_DSN: "postgres://localhost/db" }), true);
  assert.equal(pgEnabled({ VKM_PG_DSN: "" }), false);
  assert.equal(pgEnabled({ VKM_PG_DSN: "   " }), false);
});

// ── disabledMessage ──────────────────────────────────────────────────────────

test("disabledMessage: the frozen how-to-enable text, verbatim", () => {
  assert.equal(
    disabledMessage(),
    "Postgres projection off. Enable: VKM_PG=1 (or create-vkm-kit --postgres), " +
      "or start manually: node packages/vkm-memory-pg/src/pg-service.mjs --vault <vault>"
  );
});

// ── formatStatus ─────────────────────────────────────────────────────────────

test("formatStatus: adds the migrate hint only when notes === 0", () => {
  const empty = formatStatus({ ok: true, notes: 0, chunks: 0 });
  assert.match(empty.hint, /vkm-pg-migrate/);
  assert.equal(empty.notes, 0);

  const filled = formatStatus({ ok: true, notes: 12 });
  assert.equal("hint" in filled, false);
  assert.equal(filled.notes, 12);

  // Does not mutate its input.
  const health = { notes: 0 };
  void formatStatus(health);
  assert.equal("hint" in health, false);

  // Non-object payloads pass through untouched.
  assert.equal(formatStatus(null), null);
});

// ── buildGraphParams ─────────────────────────────────────────────────────────

test("buildGraphParams: defaults depth 2 / direction both / limit 50", () => {
  const p = buildGraphParams({ from: "PROJECTS/app.md" });
  assert.equal(p.get("from"), "PROJECTS/app.md");
  assert.equal(p.get("depth"), "2");
  assert.equal(p.get("direction"), "both");
  assert.equal(p.get("limit"), "50");
  assert.equal(p.get("types"), null);
});

test("buildGraphParams: types CSV is split, trimmed and re-joined", () => {
  const p = buildGraphParams({
    from: "a.md",
    types: "  implements , supersedes ,, part_of "
  });
  assert.equal(p.get("types"), "implements,supersedes,part_of");
  // All-whitespace CSV → the param is omitted entirely.
  assert.equal(buildGraphParams({ from: "a.md", types: " , " }).get("types"), null);
});

test("buildGraphParams: rejects out-of-range and malformed arguments", () => {
  assert.throws(() => buildGraphParams({ from: "" }), /from is required/);
  assert.throws(() => buildGraphParams({ from: "a.md", depth: 0 }), /between 1 and 4/);
  assert.throws(() => buildGraphParams({ from: "a.md", depth: 5 }), /between 1 and 4/);
  assert.throws(() => buildGraphParams({ from: "a.md", depth: 2.5 }), /between 1 and 4/);
  assert.throws(() => buildGraphParams({ from: "a.md", direction: "up" }), /out, in, both/);
  assert.throws(() => buildGraphParams({ from: "a.md", limit: 0 }), /between 1 and 200/);
  assert.throws(() => buildGraphParams({ from: "a.md", limit: 201 }), /between 1 and 200/);
});

// ── disabled path: no fetch, no package load ─────────────────────────────────

test("pgStatus disabled: returns the enable instructions; fetch and loaders never run", async () => {
  const fetchImpl = fetchSpy();
  let clientLoads = 0;
  let pathLoads = 0;
  const result = await pgStatus({
    vault: "C:/nowhere",
    env: {},
    fetchImpl,
    loadClient: async () => {
      clientLoads++;
      return {};
    },
    loadPaths: async () => {
      pathLoads++;
      return {};
    }
  });
  assert.equal(result, disabledMessage());
  assert.match(result, /VKM_PG=1/);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(clientLoads, 0);
  assert.equal(pathLoads, 0);
});

test("pgGraph / pgTimeline disabled: throw the enable instructions; fetch never runs", async () => {
  const fetchImpl = fetchSpy();
  const loadPaths = async () => {
    throw new Error("loadPaths must not run on the disabled path");
  };
  await assert.rejects(
    pgGraph({ vault: "C:/nowhere", from: "a.md", env: {}, fetchImpl, loadPaths }),
    (err) => err.message === disabledMessage()
  );
  await assert.rejects(
    pgTimeline({ vault: "C:/nowhere", env: {}, fetchImpl, loadPaths }),
    (err) => err.message === disabledMessage()
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// ── enabled paths against a fake service dir ─────────────────────────────────

test("pgGraph: authenticated GET /api/graph with the built params; result passes through", async () => {
  const dir = makeServiceDir({ port: 46001, token: "sekret" });
  try {
    const fetchImpl = fetchSpy(fakeResponse({ nodes: [{ path: "a.md" }], edges: [] }));
    const result = await pgGraph({
      vault: "C:/v",
      from: "PROJECTS/app.md",
      depth: 3,
      direction: "out",
      types: "implements, supersedes",
      limit: 10,
      env: { VKM_PG: "1" },
      fetchImpl,
      loadPaths: loadPathsFor(dir)
    });
    assert.deepEqual(result, { nodes: [{ path: "a.md" }], edges: [] });
    assert.equal(fetchImpl.calls.length, 1);
    const called = new URL(fetchImpl.calls[0].url);
    assert.equal(called.origin, "http://127.0.0.1:46001");
    assert.equal(called.pathname, "/api/graph");
    assert.equal(called.searchParams.get("from"), "PROJECTS/app.md");
    assert.equal(called.searchParams.get("depth"), "3");
    assert.equal(called.searchParams.get("direction"), "out");
    assert.equal(called.searchParams.get("types"), "implements,supersedes");
    assert.equal(called.searchParams.get("limit"), "10");
    assert.equal(fetchImpl.calls[0].options.headers["x-vkm-pg-token"], "sekret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pgTimeline: GET /api/timeline with limit and optional sinceId", async () => {
  const dir = makeServiceDir({ port: 46002 });
  try {
    const fetchImpl = fetchSpy(fakeResponse({ events: [] }), fakeResponse({ events: [] }));
    await pgTimeline({
      vault: "C:/v",
      env: { VKM_PG: "1" },
      fetchImpl,
      loadPaths: loadPathsFor(dir)
    });
    let called = new URL(fetchImpl.calls[0].url);
    assert.equal(called.pathname, "/api/timeline");
    assert.equal(called.searchParams.get("limit"), "20");
    assert.equal(called.searchParams.get("sinceId"), null);
    assert.equal(called.searchParams.get("scope"), null);

    await pgTimeline({
      vault: "C:/v",
      sinceId: 7,
      limit: 5,
      env: { VKM_PG: "1" },
      fetchImpl,
      loadPaths: loadPathsFor(dir)
    });
    called = new URL(fetchImpl.calls[1].url);
    assert.equal(called.searchParams.get("limit"), "5");
    assert.equal(called.searchParams.get("sinceId"), "7");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pgTimeline: scope is forwarded verbatim as the `scope` query param", async () => {
  const dir = makeServiceDir({ port: 46007 });
  try {
    const fetchImpl = fetchSpy(fakeResponse({ events: [] }));
    await pgTimeline({
      vault: "C:/v",
      scope: "AGENTS/vkm-implementer",
      env: { VKM_PG: "1" },
      fetchImpl,
      loadPaths: loadPathsFor(dir)
    });
    const called = new URL(fetchImpl.calls[0].url);
    assert.equal(called.pathname, "/api/timeline");
    assert.equal(called.searchParams.get("scope"), "AGENTS/vkm-implementer");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pgTimeline: an invalid scope is rejected before any service discovery or fetch", async () => {
  const fetchImpl = fetchSpy();
  const loadPaths = async () => {
    throw new Error("loadPaths must not run for an invalid scope");
  };
  for (const bad of ["../etc", "AGENTS/../MEMORY", "/abs/path", "C:/vault", "AGENTS\\x"]) {
    await assert.rejects(
      pgTimeline({ vault: "C:/v", scope: bad, env: { VKM_PG: "1" }, fetchImpl, loadPaths }),
      /scope must be a posix-relative path prefix/,
      `scope ${JSON.stringify(bad)} must be rejected`
    );
  }
  assert.equal(fetchImpl.calls.length, 0);
});

// ── validateScope ────────────────────────────────────────────────────────────

test("validateScope: frozen scoped-memory contract — accepts relative prefixes, rejects escapes", () => {
  assert.equal(validateScope(undefined), undefined);
  assert.equal(validateScope(null), undefined);
  assert.equal(validateScope(""), undefined);
  assert.equal(validateScope("AGENTS"), "AGENTS");
  assert.equal(validateScope("PROJECTS/vkm-kit"), "PROJECTS/vkm-kit");
  for (const bad of ["..", "a/../b", "/AGENTS", "D:/x", "d:x", "AGENTS\\name"]) {
    assert.throws(() => validateScope(bad), /posix-relative path prefix/);
  }
});

test("pgStatus enabled: best-effort ensureServiceRunning, then /api/health with the empty-projection hint", async () => {
  const dir = makeServiceDir({ port: 46003, token: "tok" });
  try {
    const ensured = [];
    const client = {
      ensureServiceRunning: async (args) => {
        ensured.push(args);
      }
    };
    const fetchImpl = fetchSpy(fakeResponse({ ok: true, backend: "pglite", notes: 0 }));
    const result = await pgStatus({
      vault: "C:/v",
      env: { VKM_PG: "1" },
      fetchImpl,
      loadClient: async () => client,
      loadPaths: loadPathsFor(dir)
    });
    // Frozen seam: the client takes { vaultAbs, env } — vault is forwarded as vaultAbs.
    assert.deepEqual(ensured, [{ vaultAbs: "C:/v", env: { VKM_PG: "1" } }]);
    assert.equal(result.backend, "pglite");
    assert.match(result.hint, /vkm-pg-migrate/);
    assert.equal(new URL(fetchImpl.calls[0].url).pathname, "/api/health");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pgStatus: a failing ensureServiceRunning is best-effort — health still answers", async () => {
  const dir = makeServiceDir({ port: 46004 });
  try {
    const client = {
      ensureServiceRunning: async () => {
        throw new Error("spawn blew up");
      }
    };
    const fetchImpl = fetchSpy(fakeResponse({ ok: true, notes: 3 }));
    const result = await pgStatus({
      vault: "C:/v",
      env: { VKM_PG: "1" },
      fetchImpl,
      loadClient: async () => client,
      loadPaths: loadPathsFor(dir)
    });
    assert.equal(result.notes, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── unavailability surfaces as disabledMessage() + (reason) ──────────────────

test("service not running (no service.json): error is disabledMessage plus the reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pg-tools-empty-"));
  try {
    const fetchImpl = fetchSpy();
    await assert.rejects(
      pgGraph({
        vault: "C:/v",
        from: "a.md",
        env: { VKM_PG: "1" },
        fetchImpl,
        loadPaths: loadPathsFor(dir)
      }),
      (err) => err.message.startsWith(disabledMessage()) && /service\.json/.test(err.message)
    );
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stale service.json (dead pid): reported as not running, no fetch attempted", async () => {
  const dir = makeServiceDir({ pid: 999999999 });
  try {
    const fetchImpl = fetchSpy();
    await assert.rejects(
      pgTimeline({
        vault: "C:/v",
        env: { VKM_PG: "1" },
        fetchImpl,
        loadPaths: loadPathsFor(dir)
      }),
      (err) => err.message.startsWith(disabledMessage()) && /stale/.test(err.message)
    );
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PgServiceUnavailableError from the sibling package is matched by name and re-shaped", async () => {
  const boom = new Error("no service for this vault");
  boom.name = "PgServiceUnavailableError";
  const fetchImpl = fetchSpy();
  await assert.rejects(
    pgGraph({
      vault: "C:/v",
      from: "a.md",
      env: { VKM_PG: "1" },
      fetchImpl,
      loadPaths: async () => ({
        vaultPgDir: () => {
          throw boom;
        }
      })
    }),
    (err) =>
      err.message.startsWith(disabledMessage()) && err.message.includes("no service for this vault")
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("HTTP 401 keeps its own message (token problem, not a disabled projection)", async () => {
  const dir = makeServiceDir({ port: 46005 });
  try {
    const fetchImpl = fetchSpy(fakeResponse({ error: "unauthorized" }, { status: 401 }));
    await assert.rejects(
      pgTimeline({
        vault: "C:/v",
        env: { VKM_PG: "1" },
        fetchImpl,
        loadPaths: loadPathsFor(dir)
      }),
      /401/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── seam pin: the REAL sibling modules export what pg-tools relies on ────────
// The DI fakes above can drift silently; these two tests import the actual
// @vkmikc/vkm-memory-pg subpaths so a rename/removal on the other side of the
// frozen seam fails HERE, in this package's suite.

test("seam pin: real /paths and /client carry vaultPgDir and ensureServiceRunning", async () => {
  const paths = await import("@vkmikc/vkm-memory-pg/paths");
  const client = await import("@vkmikc/vkm-memory-pg/client");
  assert.equal(typeof paths.vaultPgDir, "function");
  assert.equal(typeof client.ensureServiceRunning, "function");
});

test("seam pin: service discovery works against the REAL paths module (temp VKM_PG_DATA_ROOT)", async () => {
  const paths = await import("@vkmikc/vkm-memory-pg/paths");
  const root = mkdtempSync(join(tmpdir(), "pg-tools-real-root-"));
  try {
    const vault = join(tmpdir(), "pg-tools-real-vault"); // only hashed, never touched
    const env = { VKM_PG: "1", VKM_PG_DATA_ROOT: root };
    // Handcraft the frozen on-disk contract inside the dir the REAL module resolves.
    const dir = paths.vaultPgDir(vault, env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "service.json"),
      JSON.stringify({ port: 46006, pid: process.pid, vault, version: "x", startedAt: "now" }),
      "utf8"
    );
    writeFileSync(join(dir, "service.token"), "real-tok\n", "utf8");
    // No loadPaths injection: pgTimeline resolves the dir via the real subpath.
    const fetchImpl = fetchSpy(fakeResponse({ events: [] }));
    const result = await pgTimeline({ vault, env, fetchImpl });
    assert.deepEqual(result, { events: [] });
    const called = new URL(fetchImpl.calls[0].url);
    assert.equal(called.origin, "http://127.0.0.1:46006");
    assert.equal(called.pathname, "/api/timeline");
    assert.equal(fetchImpl.calls[0].options.headers["x-vkm-pg-token"], "real-tok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
