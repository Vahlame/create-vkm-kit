/**
 * One adapter, two backends: embedded PGlite (default) or an external Postgres server via
 * VKM_PG_DSN. Everything above this module (schema, sync, service, graph) speaks the same
 * five verbs — query/exec/listen/notify/close — plus a `capabilities` object that records
 * what the backend actually supports, so a missing pgvector extension degrades features
 * instead of crashing the projection.
 *
 * Both backends are loaded with dynamic import: the DSN branch must not pay for the PGlite
 * WASM bundle, and a platform where WASM init fails must be able to report that as a
 * catchable error, not a module-load crash.
 *
 * Concurrency: BOTH backends are one session (PGlite is a single connection; the DSN pool
 * is capped at one client), so a multi-statement BEGIN..COMMIT interleaved with other
 * callers would expose half-applied state — and a failing concurrent read would abort the
 * writer's open transaction. `openAdapter` therefore wraps every backend in a promise-chain
 * gate: `query`/`exec`/`listen`/`notify`/`close` each enqueue on ONE chain, and
 * `withLock(fn)` hands `fn` the raw backend while holding the whole chain, so a
 * transaction run inside `withLock` (the sync layer does this) is atomic from every other
 * caller's point of view: they observe strictly pre- or post-transaction state.
 */
import path from "node:path";
import { vaultPgDir, dataDirPath } from "./pg-paths.mjs";

/**
 * @typedef {object} PgAdapter
 * @property {"pglite"|"dsn"} backend
 * @property {{ vector: boolean, notify: boolean }} capabilities
 * @property {(sql: string, params?: unknown[]) => Promise<{ rows: any[] }>} query
 * @property {(sql: string) => Promise<void>} exec
 * @property {(channel: string, cb: (payload: string) => void) => Promise<() => Promise<void>>} listen
 * @property {(channel: string, payload: string) => Promise<void>} notify
 * @property {() => Promise<void>} close
 * @property {(fn: (raw: PgAdapter) => Promise<any>) => Promise<any>} [withLock] - run `fn`
 *   with exclusive access to the raw (ungated) backend; every other adapter call waits
 *   until `fn` settles. Multi-statement transactions MUST run inside this.
 * @property {string} [dataDir] - PGlite backend only: the datadir in use
 */

/**
 * Open the projection database for a vault.
 *
 * Backend selection: `env.VKM_PG_DSN` set -> external server through `pg`; otherwise
 * embedded PGlite at `<vaultPgDir>/data` (or `memory://` when `env.VKM_PG_MEMORY === "1"`,
 * the in-memory test mode).
 *
 * @param {{ vaultAbs: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {Promise<PgAdapter>}
 */
export async function openAdapter({ vaultAbs, env = process.env }) {
  const base = env.VKM_PG_DSN
    ? await openDsnAdapter(env.VKM_PG_DSN)
    : await openPgliteAdapter(vaultAbs, env);
  return gateAdapter(base);
}

/**
 * Serialize ALL access to a single-session backend through one promise chain (see the
 * module header). `withLock(fn)` passes `fn` the RAW backend — statements inside the lock
 * run directly, so a locked transaction never deadlocks on its own gate — while the chain
 * keeps every other caller queued until `fn` settles.
 * @param {PgAdapter} base
 * @returns {PgAdapter}
 */
function gateAdapter(base) {
  /** @type {Promise<unknown>} */
  let chain = Promise.resolve();
  /**
   * @template T
   * @param {() => Promise<T> | T} task
   * @returns {Promise<T>}
   */
  const enqueue = (task) => {
    const run = chain.then(task, task);
    // The gate must survive task failures; the enqueuer still sees its own error via `run`.
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  return {
    ...base,
    query: (sql, params = []) => enqueue(() => base.query(sql, params)),
    exec: (sql) => enqueue(() => base.exec(sql)),
    listen: (channel, cb) => enqueue(() => base.listen(channel, cb)),
    notify: (channel, payload) => enqueue(() => base.notify(channel, payload)),
    close: () => enqueue(() => base.close()),
    withLock: (fn) => enqueue(() => fn(base))
  };
}

/** Attempt CREATE EXTENSION vector; report whether the backend can do vectors. */
async function tryVectorExtension(exec) {
  try {
    await exec("CREATE EXTENSION IF NOT EXISTS vector");
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} vaultAbs
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<PgAdapter>}
 */
async function openPgliteAdapter(vaultAbs, env) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const dataDir =
    env.VKM_PG_MEMORY === "1" ? "memory://" : dataDirPath(vaultPgDir(path.resolve(vaultAbs), env));
  const db = new PGlite(dataDir, { extensions: { vector } });
  await db.waitReady;

  const exec = async (sql) => {
    await db.exec(sql);
  };
  const capabilities = { vector: await tryVectorExtension(exec), notify: true };

  return {
    backend: "pglite",
    capabilities,
    dataDir,
    query: async (sql, params = []) => {
      const res = await db.query(sql, params);
      return { rows: res.rows ?? [] };
    },
    exec,
    listen: async (channel, cb) => {
      const unsub = await db.listen(channel, (payload) => cb(String(payload)));
      return async () => {
        await unsub();
      };
    },
    notify: async (channel, payload) => {
      await db.query("SELECT pg_notify($1, $2)", [channel, String(payload)]);
    },
    close: async () => {
      await db.close();
    }
  };
}

/**
 * External-server branch. The pool is capped at ONE client on purpose: the service is a
 * single-writer localhost sidecar, and a max-1 pool serializes every query onto the same
 * connection, which is what makes plain `BEGIN`/`COMMIT` through `query()` transactional
 * instead of scattered across pool members.
 * @param {string} dsn
 * @returns {Promise<PgAdapter>}
 */
async function openDsnAdapter(dsn) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  // Fail fast on a bad DSN instead of at the first real query.
  await pool.query("SELECT 1");

  const exec = async (sql) => {
    await pool.query(sql);
  };
  const capabilities = { vector: await tryVectorExtension(exec), notify: true };

  /** @type {import("pg").Client | null} */
  let listenClient = null;
  /** @type {Map<string, Set<(payload: string) => void>>} */
  const listeners = new Map();

  return {
    backend: "dsn",
    capabilities,
    query: async (sql, params = []) => {
      const res = await pool.query(sql, params);
      return { rows: res.rows ?? [] };
    },
    exec,
    listen: async (channel, cb) => {
      if (!listenClient) {
        listenClient = new pg.Client({ connectionString: dsn });
        await listenClient.connect();
        listenClient.on("notification", (msg) => {
          for (const fn of listeners.get(msg.channel) ?? []) fn(String(msg.payload ?? ""));
        });
        // A dropped LISTEN connection must not crash the service; SSE just goes quiet.
        listenClient.on("error", () => {});
      }
      if (!listeners.has(channel)) {
        listeners.set(channel, new Set());
        await listenClient.query(`LISTEN ${quoteIdent(channel)}`);
      }
      listeners.get(channel)?.add(cb);
      return async () => {
        const set = listeners.get(channel);
        set?.delete(cb);
        if (set && set.size === 0) {
          listeners.delete(channel);
          try {
            await listenClient?.query(`UNLISTEN ${quoteIdent(channel)}`);
          } catch {
            // connection may already be gone — unsubscribe is best-effort
          }
        }
      };
    },
    notify: async (channel, payload) => {
      await pool.query("SELECT pg_notify($1, $2)", [channel, String(payload)]);
    },
    close: async () => {
      if (listenClient) {
        try {
          await listenClient.end();
        } catch {
          // already closed
        }
        listenClient = null;
      }
      await pool.end();
    }
  };
}

/** Double-quote an identifier for LISTEN/UNLISTEN (channel names are not parameterizable). */
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}
