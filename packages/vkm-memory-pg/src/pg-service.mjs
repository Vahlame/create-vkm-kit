#!/usr/bin/env node
/**
 * vkm-pg-service — the per-vault singleton that OWNS the projection database.
 *
 * PGlite is single-writer, so exactly one process holds it and everyone else (MCP sidecar,
 * migrate CLI, dashboards) speaks localhost HTTP. Binds 127.0.0.1 ONLY; auth is a shared
 * random token on disk next to the datadir (`x-vkm-pg-token` header; GET /api/health is
 * exempt so liveness probes need no secret).
 *
 * Boot: resolve vault -> if a live sibling already serves it, print one line and exit 0
 * (same singleton idiom as vkm-otel-sink) -> open adapter -> ensureSchema -> best-effort
 * initial incremental sync (a failed sync must NOT keep the service down: the API over
 * yesterday's projection beats no API) -> listen -> write service.json + service.lock.
 *
 * Watcher: fs.watch(vault, recursive) with a 15s quiet-period debounce feeding incremental
 * syncs. Recursive fs.watch throws on some platforms (Linux < 20.13 semantics, odd mounts)
 * — degrade to watching:false, everything else still works.
 *
 * ADR-0078: nothing here opens a browser or a visible console, ever.
 */
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { isEntryPoint } from "@vkmikc/vkm-core/mcp-result";
import {
  vaultPgDir,
  serviceInfoPath,
  lockPath,
  tokenPath,
  readServiceInfo,
  readToken,
  lockAlive
} from "./pg-paths.mjs";
import { openAdapter } from "./pg-adapter.mjs";
import { ensureSchema, metaGet } from "./pg-schema.mjs";
import { runDump, syncFromDump, embedQuery } from "./pg-sync.mjs";
import { graphHops, fullGraph } from "./graph-query.mjs";
import { isValidScope, scopeMatchSql } from "./scope.mjs";
import { foldText, vecToSqlLiteral, b64ToFloat32 } from "./fold.mjs";

const PKG_VERSION = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

const HEARTBEAT_MS = 25_000;
const DEFAULT_DEBOUNCE_MS = 15_000;
/** Hard cap on request bodies — generous for any control-plane JSON, small enough that a
 * client cannot stream the process out of memory. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Path segments the watcher must never react to. */
const WATCH_IGNORE = [".git", ".obsidian", ".obsidian-memory-rag", "node_modules", ".trash"];

/** One SSE frame (local copy of the vkm-spec wire shape — no cross-package import). */
export function formatSseEvent(event, dataObj) {
  return `event: ${event}\ndata: ${JSON.stringify(dataObj)}\n\n`;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data)
  });
  res.end(data);
}

/** Thrown by start() when a live sibling already holds the boot lock. Callers treat it as
 * a clean "nothing to do" — main() prints one line and exits 0, never as a failure. */
export class AlreadyRunningError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "AlreadyRunningError";
  }
}

/**
 * Read a request body as UTF-8, capped at MAX_BODY_BYTES. On an oversized body this
 * answers 413 itself and resolves `null` — the caller must bail out without writing
 * another response.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<string | null>}
 */
function readBody(req, res) {
  return new Promise((resolve, reject) => {
    // Decode at the stream layer: Node buffers a multi-byte UTF-8 sequence split across
    // chunk boundaries, whereas per-Buffer string concatenation would corrupt each split
    // sequence into U+FFFD replacement characters.
    req.setEncoding("utf8");
    let raw = "";
    let bytes = 0;
    let over = false;
    req.on("data", (chunk) => {
      if (over) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        over = true;
        res.setHeader("Connection", "close");
        sendJson(res, 413, { error: `body exceeds ${MAX_BODY_BYTES} bytes` });
        resolve(null);
        // The rest of the upload is drained and DISCARDED (the `over` guard above), not
        // destroyed: an RST here would race the client's read of the 413. Memory stays
        // capped, `Connection: close` ends the socket once the request drains, and the
        // server's built-in requestTimeout bounds a hostile infinite stream.
      } else {
        raw += chunk;
      }
    });
    // The first settle wins: after the 413 path resolved null, these are no-ops.
    req.on("end", () => resolve(over ? null : raw));
    req.on("error", reject);
  });
}

/**
 * Read the optional `scope` parameter (query string or JSON body value). Absent and empty
 * both mean "unscoped" (URLSearchParams yields "" for a bare `&scope=`); anything else must
 * pass the frozen contract's validation or the request is answered 400 — an invalid scope
 * REJECTS, it never degrades to "no filter" or "no results".
 * @param {unknown} raw
 * @returns {{ scope: string | null } | { invalid: true }}
 */
function readScope(raw) {
  if (raw === null || raw === undefined) return { scope: null };
  if (typeof raw !== "string") return { invalid: true };
  if (raw === "") return { scope: null };
  return isValidScope(raw) ? { scope: raw } : { invalid: true };
}

/** Vault resolution precedence shared with the sidecar (frozen contract). */
export function resolveVaultFromEnv(env = process.env) {
  const raw = env.VKM_VAULT || env.BASIC_MEMORY_HOME || env.OBSIDIAN_MEMORY_VAULT;
  return raw ? path.resolve(raw) : null;
}

/**
 * Build (but do not start) a pg-service instance.
 * @param {{
 *   vaultAbs: string,
 *   env?: NodeJS.ProcessEnv,
 *   port?: number,
 *   watch?: boolean,
 *   debounceMs?: number,
 *   initialSync?: boolean,
 *   deps?: { runDump?: typeof runDump, embedQuery?: typeof embedQuery,
 *            openAdapter?: typeof openAdapter }
 * }} opts
 * @returns {{ server: import("node:http").Server, start: () => Promise<number>,
 *   stop: () => Promise<void>, getAdapter: () => import("./pg-adapter.mjs").PgAdapter | null }}
 */
export function createService({
  vaultAbs,
  env = process.env,
  port,
  watch = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  initialSync = true,
  deps = {}
}) {
  const vault = path.resolve(vaultAbs);
  const dir = vaultPgDir(vault, env);
  const doDump = deps.runDump ?? runDump;
  const doEmbed = deps.embedQuery ?? embedQuery;
  const doOpen = deps.openAdapter ?? openAdapter;

  /** @type {import("./pg-adapter.mjs").PgAdapter | null} */
  let adapter = null;
  let token = "";
  let pgVersion = "";
  let watching = false;
  /** @type {fs.FSWatcher | null} */
  let watcher = null;
  /** @type {NodeJS.Timeout | null} */
  let debounceTimer = null;
  /** @type {Set<import("node:http").ServerResponse>} */
  const sseClients = new Set();
  /** Serializes writes: PGlite is one connection, and two concurrent syncs interleaving
   * BEGIN/COMMIT on it would corrupt each other's transaction.
   * @type {Promise<unknown>} */
  let syncChain = Promise.resolve();

  function queueSync(mode) {
    const run = async () => {
      const since = mode === "full" ? null : await metaGet(adapter, "cursor_mtime_ns");
      const dump = await doDump({
        vaultAbs: vault,
        sinceMtimeNs: mode === "full" ? null : since,
        includeVectors: true,
        env
      });
      // vaultAbs + runDump wire syncFromDump's escalation (watermark-gap follow-up dump,
      // dim-drift full resync); the injectable doDump keeps it testable.
      return syncFromDump(adapter, dump, { vaultAbs: vault, env, runDump: doDump });
    };
    const next = syncChain.then(run, run);
    // Keep the chain alive after a failure; the caller of THIS sync still sees its error.
    syncChain = next.catch(() => {});
    return next;
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = url.pathname;

    if (req.method === "GET" && route === "/api/health") {
      return handleHealth(res);
    }
    if (req.headers["x-vkm-pg-token"] !== token) {
      return sendJson(res, 401, { error: "unauthorized" });
    }

    if (req.method === "POST" && route === "/api/sync") {
      const raw = await readBody(req, res);
      if (raw === null) return; // 413 already sent
      let mode = "incremental";
      try {
        const body = JSON.parse(raw || "{}");
        if (body.mode === "full") mode = "full";
      } catch {
        return sendJson(res, 400, { error: "invalid JSON body" });
      }
      return sendJson(res, 200, await queueSync(mode));
    }

    if (req.method === "GET" && route === "/api/graph") {
      const scoped = readScope(url.searchParams.get("scope"));
      if ("invalid" in scoped) return sendJson(res, 400, { error: "invalid scope" });
      const from = url.searchParams.get("from");
      const limit = Number(url.searchParams.get("limit")) || undefined;
      if (!from) return sendJson(res, 200, await fullGraph(adapter, limit, scoped.scope));
      const typesCsv = url.searchParams.get("types");
      return sendJson(
        res,
        200,
        await graphHops(adapter, {
          from,
          depth: Number(url.searchParams.get("depth")) || 1,
          direction: /** @type {any} */ (url.searchParams.get("direction") || "both"),
          types: typesCsv
            ? typesCsv
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : null,
          limit,
          scope: scoped.scope
        })
      );
    }

    if (req.method === "GET" && route === "/api/timeline") {
      const scoped = readScope(url.searchParams.get("scope"));
      if ("invalid" in scoped) return sendJson(res, 400, { error: "invalid scope" });
      const scope = scoped.scope;
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 1000);
      // Branch on parameter PRESENCE: Number(null) is 0 (finite), which would route every
      // no-sinceId request into the ascending branch and serve the OLDEST events.
      const rawSince = url.searchParams.get("sinceId");
      const sinceId = rawSince === null ? null : Number(rawSince);
      // A scoped timeline keeps only events whose path sits inside the scope. Rows with a
      // NULL path (kind='sync' etc.) fail the predicate, so they pass ONLY when unscoped —
      // exactly the contract: vault-wide events are not attributable to a namespace.
      const scopeSql = (idx) => (scope === null ? "" : ` AND ${scopeMatchSql("path", idx)}`);
      const rows =
        sinceId !== null && Number.isFinite(sinceId)
          ? (
              await adapter.query(
                `SELECT id, at, kind, path, detail FROM activity WHERE id > $1${scopeSql(3)} ORDER BY id ASC LIMIT $2`,
                scope === null ? [sinceId, limit] : [sinceId, limit, scope]
              )
            ).rows
          : (
              await adapter.query(
                `SELECT id, at, kind, path, detail FROM activity WHERE TRUE${scopeSql(2)} ORDER BY id DESC LIMIT $1`,
                scope === null ? [limit] : [limit, scope]
              )
            ).rows;
      return sendJson(res, 200, { events: rows.map(timelineEvent) });
    }

    if (req.method === "GET" && route === "/api/stats") {
      const scoped = readScope(url.searchParams.get("scope"));
      if ("invalid" in scoped) return sendJson(res, 400, { error: "invalid scope" });
      return sendJson(res, 200, await collectStats(scoped.scope));
    }

    if (req.method === "POST" && route === "/api/search") {
      const raw = await readBody(req, res);
      if (raw === null) return; // 413 already sent
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return sendJson(res, 400, { error: "invalid JSON body" });
      }
      const q = String(body.q ?? "").trim();
      if (!q) return sendJson(res, 400, { error: "q is required" });
      // Body field wins; `&scope=` on the URL is accepted for parity with the GET routes.
      const scoped = readScope(body.scope ?? url.searchParams.get("scope"));
      if ("invalid" in scoped) return sendJson(res, 400, { error: "invalid scope" });
      const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 200);
      if (body.mode === "vector") return handleVectorSearch(res, q, limit, scoped.scope);
      return handleFtsSearch(res, q, limit, scoped.scope);
    }

    if (req.method === "GET" && route === "/api/events") {
      return handleSse(req, res);
    }

    if (req.method === "GET" && route === "/api/suggestions") {
      const scoped = readScope(url.searchParams.get("scope"));
      if ("invalid" in scoped) return sendJson(res, 400, { error: "invalid scope" });
      const status = url.searchParams.get("status") || "pending";
      const scope = scoped.scope;
      const scopeSql = scope === null ? "" : ` AND ${scopeMatchSql("path", 2)}`;
      const params = scope === null ? [status] : [status, scope];
      const { rows } = await adapter.query(
        `SELECT id, path, kind, payload, status, created_at FROM suggestions WHERE status = $1${scopeSql} ORDER BY id DESC LIMIT 200`,
        params
      );
      return sendJson(res, 200, {
        suggestions: rows.map((r) => ({
          id: Number(r.id),
          path: String(r.path),
          kind: String(r.kind),
          payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
          status: String(r.status),
          createdAt: new Date(r.created_at).toISOString()
        }))
      });
    }

    return sendJson(res, 404, { error: "not found" });
  }

  async function handleHealth(res) {
    // Unauthenticated liveness probe — omit the absolute vault path (multi-user
    // localhost can discover the port). Token-gated /api/stats carries `vault`.
    if (!adapter) return sendJson(res, 503, { error: "service stopping" });
    const count = async (table) =>
      Number((await adapter.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
    const [notes, chunks, relations, observations] = await Promise.all([
      count("notes"),
      count("chunks"),
      count("relations"),
      count("observations")
    ]);
    const dim = await metaGet(adapter, "dim");
    sendJson(res, 200, {
      ok: true,
      version: PKG_VERSION,
      backend: adapter.backend,
      pgVersion,
      notes,
      chunks,
      relations,
      observations,
      lastSyncAt: await metaGet(adapter, "last_sync_at"),
      embedder: await metaGet(adapter, "embedder"),
      dim: dim === null ? null : Number(dim),
      capabilities: adapter.capabilities,
      watching
    });
  }

  function timelineEvent(r) {
    return {
      id: Number(r.id),
      at: new Date(r.at).toISOString(),
      kind: String(r.kind),
      path: r.path === null || r.path === undefined ? null : String(r.path),
      detail: typeof r.detail === "string" ? JSON.parse(r.detail) : (r.detail ?? {})
    };
  }

  /** @param {string | null} [scope] - already-validated namespace filter */
  async function collectStats(scope = null) {
    const pairs = (rows, k) => rows.map((r) => [String(r[k]), Number(r.n)]);
    // Notes/chunks filter on their own path; observations/relations on source_path (the
    // note that carries them — same anchoring the graph's scoped edges use).
    const where = (col) => (scope === null ? "" : ` WHERE ${scopeMatchSql(col, 1)}`);
    const params = scope === null ? [] : [scope];
    const [byFolder, byCategory, byType, tags, chunkCount] = await Promise.all([
      adapter.query(
        `SELECT folder, count(*)::int AS n FROM notes${where("path")} GROUP BY folder ORDER BY n DESC, folder`,
        params
      ),
      adapter.query(
        `SELECT category, count(*)::int AS n FROM observations${where("source_path")} GROUP BY category ORDER BY n DESC, category`,
        params
      ),
      adapter.query(
        `SELECT relation_type, count(*)::int AS n FROM relations${where("source_path")} GROUP BY relation_type ORDER BY n DESC, relation_type`,
        params
      ),
      adapter.query(
        `SELECT t AS tag, count(*)::int AS n FROM observations, unnest(tags) AS t${where("source_path")} GROUP BY t ORDER BY n DESC, t LIMIT 25`,
        params
      ),
      adapter.query(`SELECT count(*)::int AS n FROM chunks${where("path")}`, params)
    ]);
    return {
      vault,
      notesByFolder: pairs(byFolder.rows, "folder"),
      observationsByCategory: pairs(byCategory.rows, "category"),
      relationsByType: pairs(byType.rows, "relation_type"),
      topTags: pairs(tags.rows, "tag"),
      chunkCount: Number(chunkCount.rows[0].n)
    };
  }

  /** @param {string | null} [scope] - already-validated namespace filter */
  async function handleFtsSearch(res, q, limit, scope = null) {
    const folded = foldText(q);
    const scopeSql = scope === null ? "" : ` AND ${scopeMatchSql("n.path", 3)}`;
    const params = scope === null ? [folded, limit] : [folded, limit, scope];
    const { rows } = await adapter.query(
      `SELECT n.path,
              '' AS heading,
              ts_headline('simple', n.body_fold, websearch_to_tsquery('simple', $1)) AS snippet,
              ts_rank_cd(n.tsv, websearch_to_tsquery('simple', $1))::float8 AS rank
       FROM notes n
       WHERE n.tsv @@ websearch_to_tsquery('simple', $1)${scopeSql}
       ORDER BY rank DESC, n.path
       LIMIT $2`,
      params
    );
    sendJson(res, 200, {
      hits: rows.map((r) => ({
        path: String(r.path),
        heading: String(r.heading ?? ""),
        snippet: String(r.snippet ?? ""),
        rank: Number(r.rank)
      }))
    });
  }

  /** Vector mode degrades to `{error, hits: []}` with HTTP 200 — the contract's shape for
   * "the projection works, embeddings don't": missing extension, no vectors on disk, or a
   * failed query-embedding shell-out are all normal states, not server errors. */
  async function handleVectorSearch(res, q, limit, scope = null) {
    const unavailable = (reason) =>
      sendJson(res, 200, { error: `vector search unavailable: ${reason}`, hits: [] });
    if (!adapter.capabilities.vector) return unavailable("pgvector extension missing");
    if ((await metaGet(adapter, "dim")) === null) return unavailable("no embeddings synced");
    let emb;
    try {
      emb = await doEmbed({ vaultAbs: vault, query: q, env });
    } catch (e) {
      return unavailable(e?.message || String(e));
    }
    if (!emb || emb.error || typeof emb.vec_b64 !== "string") {
      return unavailable(emb?.error || "no query embedding produced");
    }
    const lit = vecToSqlLiteral(b64ToFloat32(emb.vec_b64));
    const scopeSql = scope === null ? "" : ` AND ${scopeMatchSql("path", 3)}`;
    const params = scope === null ? [lit, limit] : [lit, limit, scope];
    const { rows } = await adapter.query(
      `SELECT path, heading, left(body, 240) AS snippet,
              (1 - (vec <=> $1::vector))::float8 AS rank
       FROM chunks
       WHERE vec IS NOT NULL${scopeSql}
       ORDER BY vec <=> $1::vector
       LIMIT $2`,
      params
    );
    sendJson(res, 200, {
      hits: rows.map((r) => ({
        path: String(r.path),
        heading: String(r.heading ?? ""),
        snippet: String(r.snippet ?? ""),
        rank: Number(r.rank)
      }))
    });
  }

  async function handleSse(req, res) {
    // A client that vanishes mid-stream must never crash the service (same invariant as
    // vkm-spec's SSE handler): writing to a destroyed socket emits 'error' by default.
    res.on("error", () => {});
    let closed = false;
    /** @type {NodeJS.Timeout | null} */
    let heartbeat = null;
    /** @type {(() => Promise<unknown>) | null} */
    let unsubscribe = null;
    // Registered BEFORE the first await: a socket that dies while the max(id) query or
    // adapter.listen is pending emits 'close' immediately — a handler attached only after
    // those awaits would never fire, leaking the heartbeat timer, the sseClients entry,
    // and the LISTEN subscription for the life of the process.
    req.on("close", () => {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      sseClients.delete(res);
      if (unsubscribe) void unsubscribe().catch(() => {});
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    sseClients.add(res);

    const { rows } = await adapter.query("SELECT COALESCE(max(id), 0)::int AS n FROM activity");
    if (closed) return;
    res.write(formatSseEvent("hello", { lastId: Number(rows[0].n) }));

    heartbeat = setInterval(() => res.write(":hb\n\n"), HEARTBEAT_MS);
    heartbeat.unref();

    const onActivity = async (payload) => {
      try {
        const id = Number(payload);
        if (!Number.isFinite(id)) return;
        const r = await adapter.query(
          "SELECT id, at, kind, path, detail FROM activity WHERE id = $1",
          [id]
        );
        if (r.rows.length) res.write(formatSseEvent("activity", timelineEvent(r.rows[0])));
      } catch {
        // a dropped frame is fine; the client re-reads /api/timeline on reconnect
      }
    };
    unsubscribe = await adapter.listen("vkm_activity", (payload) => {
      void onActivity(payload);
    });
    // 'close' may have fired while adapter.listen was pending — the handler saw
    // unsubscribe === null then, so undo the subscription here.
    if (closed) void unsubscribe().catch(() => {});
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      try {
        sendJson(res, 500, { error: e?.message || String(e) });
      } catch {
        // headers already sent (e.g. SSE stream) — nothing more to say
      }
    });
  });

  /**
   * Take the single-writer boot mutex with O_EXCL (`wx`) — BEFORE the datadir is opened,
   * so two processes racing past main()'s sibling check cannot both hold PGlite. A stale
   * lock (crashed service, dead pid) is unlinked and the acquisition retried exactly once.
   * @throws {AlreadyRunningError} when a live sibling holds the lock
   */
  function acquireBootLock() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid }), { flag: "wx" });
        return;
      } catch (e) {
        if (e?.code !== "EEXIST") throw e;
        if (lockAlive(dir)) {
          throw new AlreadyRunningError(`vkm-pg-service already running for ${vault}`);
        }
        try {
          fs.unlinkSync(lockPath(dir)); // stale — the retry below takes it with wx again
        } catch {
          // raced another booter's cleanup; the retry decides who wins
        }
      }
    }
    throw new AlreadyRunningError(`vkm-pg-service already running for ${vault} (lock contended)`);
  }

  async function start() {
    fs.mkdirSync(dir, { recursive: true });
    acquireBootLock();
    try {
      adapter = await doOpen({ vaultAbs: vault, env });
      const { needsRebuild } = await ensureSchema(adapter);
      if (needsRebuild) {
        console.error(
          "[vkm-pg-service] PGlite MAJOR.MINOR changed since this datadir was created — " +
            "the projection may be unreadable. Run: vkm-pg-migrate --rebuild"
        );
      }
      pgVersion = String(
        (await adapter.query("SELECT current_setting('server_version') AS v")).rows[0].v
      );

      token = readToken(dir) ?? "";
      if (!token) {
        token = crypto.randomBytes(32).toString("hex");
        fs.writeFileSync(tokenPath(dir), token, { encoding: "utf8", mode: 0o600 });
      }

      if (initialSync) {
        try {
          await queueSync("incremental");
        } catch (e) {
          console.error(
            `[vkm-pg-service] initial sync failed (service still starts): ${e?.message || e}`
          );
        }
      }

      const wantPort = port ?? (Number(env.VKM_PG_PORT) || 0);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(wantPort, "127.0.0.1", () => resolve(undefined));
      });
      const bound = /** @type {import("node:net").AddressInfo} */ (server.address()).port;

      fs.writeFileSync(
        serviceInfoPath(dir),
        JSON.stringify({
          port: bound,
          pid: process.pid,
          vault,
          version: PKG_VERSION,
          startedAt: new Date().toISOString()
        }),
        "utf8"
      );
      // Rewrite OUR lock (taken pid-only by acquireBootLock) with the bound port.
      fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, port: bound }), "utf8");

      return finishStart(bound);
    } catch (e) {
      // A failed boot must not leave the mutex behind (bricking every later start) nor
      // the single-writer datadir open.
      if (adapter) {
        await adapter.close().catch(() => {});
        adapter = null;
      }
      try {
        fs.unlinkSync(lockPath(dir));
      } catch {
        // best-effort
      }
      throw e;
    }
  }

  /** @param {number} bound @returns {number} */
  function finishStart(bound) {
    if (watch) {
      try {
        watcher = fs.watch(vault, { recursive: true }, (_event, filename) => {
          const rel = String(filename ?? "").replace(/\\/g, "/");
          if (WATCH_IGNORE.some((seg) => rel === seg || rel.split("/").includes(seg))) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            queueSync("incremental").catch((e) =>
              console.error(`[vkm-pg-service] watch sync failed: ${e?.message || e}`)
            );
          }, debounceMs);
          debounceTimer.unref();
        });
        watcher.on("error", () => {
          watching = false;
        });
        watching = true;
      } catch {
        watching = false; // recursive fs.watch is not supported everywhere — degrade
      }
    }

    return bound;
  }

  async function stop() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    watching = false;
    for (const res of sseClients) {
      try {
        res.end();
      } catch {
        // already gone
      }
    }
    sseClients.clear();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
    for (const fp of [lockPath(dir), serviceInfoPath(dir)]) {
      try {
        fs.unlinkSync(fp);
      } catch {
        // best-effort cleanup
      }
    }
  }

  return { server, start, stop, getAdapter: () => adapter };
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** True when GET /api/health on a recorded port answers 2xx within 1.5s. */
async function portHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const vault = flagValue(argv, "--vault") ?? resolveVaultFromEnv();
  if (!vault) {
    console.error(
      "vkm-pg-service: no vault. Pass --vault <path> or set VKM_VAULT / BASIC_MEMORY_HOME / OBSIDIAN_MEMORY_VAULT."
    );
    process.exitCode = 1;
    return;
  }
  const vaultAbs = path.resolve(vault);
  const env = { ...process.env };
  const dsn = flagValue(argv, "--dsn");
  if (dsn) env.VKM_PG_DSN = dsn;
  if (env.VKM_PG !== "1") {
    // Informational only — running the service by hand is an explicit opt-in.
    console.error("[vkm-pg-service] note: VKM_PG=1 is not set; starting anyway (explicit run).");
  }

  const dir = vaultPgDir(vaultAbs, env);
  const alive = readServiceInfo(dir);
  // A live pid is necessary but NOT sufficient: after an unclean shutdown an unrelated
  // process can recycle the recorded pid, making stale service.json read as live forever.
  // Only an answering /api/health on the recorded port earns "already running"; a failed
  // probe falls through to boot (the wx boot lock in start() still arbitrates real races).
  if (alive && (await portHealthy(alive.port))) {
    console.log(
      `vkm-pg-service already running for ${vaultAbs} on port ${alive.port} (pid ${alive.pid})`
    );
    return;
  }

  const service = createService({
    vaultAbs,
    env,
    port: flagValue(argv, "--port") ? Number(flagValue(argv, "--port")) : undefined,
    watch: !argv.includes("--no-watch")
  });
  let boundPort;
  try {
    boundPort = await service.start();
  } catch (e) {
    if (e instanceof AlreadyRunningError) {
      // Race loser: a sibling holds the datadir, which is the desired end state — exit 0.
      console.log(e.message);
      return;
    }
    throw e;
  }
  console.log(`vkm-pg-service for ${vaultAbs} on http://127.0.0.1:${boundPort}`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await service.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

if (isEntryPoint(import.meta.url)) {
  main().catch((e) => {
    console.error(`vkm-pg-service failed to start: ${e?.message || e}`);
    process.exit(1);
  });
}
