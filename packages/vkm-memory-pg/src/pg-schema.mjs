/**
 * Contract DDL (schema_version 1) + meta helpers + the PGlite datadir version guard.
 *
 * The dialect must run on BOTH PGlite (PG 18) and any external Postgres >= 14, and PGlite
 * makes no multi-statement exec guarantees — so every statement executes individually, in
 * order, each one idempotent (IF NOT EXISTS / generated column in CREATE TABLE).
 */
import { readFileSync } from "node:fs";

/** Contract DDL, one statement per entry — execute in order, never joined. */
export const SCHEMA_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS meta(key text PRIMARY KEY, value text NOT NULL)",
  "CREATE TABLE IF NOT EXISTS notes(path text PRIMARY KEY, title text NOT NULL DEFAULT '', mtime_ns bigint NOT NULL, size_b bigint NOT NULL DEFAULT 0, folder text NOT NULL DEFAULT '', body_fold text NOT NULL DEFAULT '', tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', body_fold)) STORED)",
  "CREATE INDEX IF NOT EXISTS idx_notes_tsv ON notes USING GIN(tsv)",
  "CREATE TABLE IF NOT EXISTS chunks(path text NOT NULL, ordinal int NOT NULL, embedder text NOT NULL, heading text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', PRIMARY KEY(path, ordinal, embedder))",
  "CREATE TABLE IF NOT EXISTS relations(source_path text NOT NULL, relation_type text NOT NULL, target text NOT NULL, context text NOT NULL DEFAULT '', PRIMARY KEY(source_path, relation_type, target))",
  "CREATE TABLE IF NOT EXISTS observations(source_path text NOT NULL, ordinal int NOT NULL, category text NOT NULL, content text NOT NULL, tags text[] NOT NULL DEFAULT '{}', PRIMARY KEY(source_path, ordinal))",
  "CREATE TABLE IF NOT EXISTS activity(id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, path text, detail jsonb NOT NULL DEFAULT '{}')",
  "CREATE TABLE IF NOT EXISTS suggestions(id bigserial PRIMARY KEY, path text NOT NULL, kind text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now())"
];

export const SCHEMA_VERSION = "1";

/**
 * The installed @electric-sql/pglite version. Read from this package's own manifest — the
 * dependency is pinned EXACT (peer-locked with pglite-pgvector), so the declared spec IS
 * the installed version; pglite's own package.json sits behind an exports map that blocks
 * `require.resolve`.
 * @returns {string}
 */
export function installedPgliteVersion() {
  const own = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return String(own.dependencies["@electric-sql/pglite"]).replace(/^[\^~]/, "");
}

/**
 * Read one meta value.
 * @param {import("./pg-adapter.mjs").PgAdapter} adapter
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function metaGet(adapter, key) {
  const { rows } = await adapter.query("SELECT value FROM meta WHERE key = $1", [key]);
  return rows.length ? String(rows[0].value) : null;
}

/**
 * Upsert one meta value.
 * @param {import("./pg-adapter.mjs").PgAdapter} adapter
 * @param {string} key
 * @param {string} value
 */
export async function metaSet(adapter, key, value) {
  await adapter.query(
    "INSERT INTO meta(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, String(value)]
  );
}

/**
 * Create every contract table/index (idempotent) and run the PGlite datadir version guard.
 *
 * Guard semantics: a PGlite MAJOR.MINOR bump can change the WASM data format, making an
 * old datadir unreadable or subtly wrong. The wipe is NOT automatic — the datadir is a
 * disposable projection, but deleting data is the USER's call: we return
 * `{ needsRebuild: true }` and callers surface it (vkm-pg-migrate offers `--rebuild`).
 *
 * @param {import("./pg-adapter.mjs").PgAdapter} adapter
 * @returns {Promise<{ needsRebuild: boolean }>}
 */
export async function ensureSchema(adapter) {
  for (const stmt of SCHEMA_STATEMENTS) {
    await adapter.exec(stmt);
  }
  await metaSet(adapter, "schema_version", SCHEMA_VERSION);

  let needsRebuild = false;
  if (adapter.backend === "pglite") {
    const installed = installedPgliteVersion();
    const recorded = await metaGet(adapter, "pglite_version");
    if (recorded && majorMinor(recorded) !== majorMinor(installed)) {
      needsRebuild = true;
    } else if (!recorded) {
      await metaSet(adapter, "pglite_version", installed);
    }
  }
  return { needsRebuild };
}

/** "0.5.4" -> "0.5" */
function majorMinor(v) {
  return String(v).split(".").slice(0, 2).join(".");
}

/**
 * Ensure the `vec vector(dim)` column on chunks exists AT THIS DIMENSION, guarded by
 * `capabilities.vector`.
 *
 * `ADD COLUMN IF NOT EXISTS` alone would silently no-op when the column already exists at
 * a DIFFERENT dimension (the embedder changed), and every later vector insert would then
 * fail with "expected N dimensions", bricking sync permanently. So the existing dimension
 * is read from `pg_attribute` (pgvector stores the declared dimension directly as the
 * column's `atttypmod`) and on mismatch the column and its index are dropped and re-added
 * at the new dimension. That wipes every stored vector — fine for a disposable projection,
 * but paths outside the current dump lose theirs, so the caller must force a full resync
 * (`syncFromDump` does, via its dim-drift escalation keyed on `rebuilt` + the meta `dim`).
 *
 * An ivfflat index is only worth building past a real corpus size (the pgvector docs'
 * guidance) — under 5000 chunks a sequential scan wins, so none is created there.
 * @param {import("./pg-adapter.mjs").PgAdapter} adapter
 * @param {number} dim
 * @returns {Promise<{ present: boolean, rebuilt: boolean }>} `present`: the column exists
 *   after the call; `rebuilt`: it was dropped and re-added because the dimension drifted.
 */
export async function ensureVecColumn(adapter, dim) {
  if (!adapter.capabilities.vector) return { present: false, rebuilt: false };
  const d = Number(dim);
  if (!Number.isInteger(d) || d <= 0) throw new Error(`invalid vector dimension: ${dim}`);
  const { rows } = await adapter.query(
    "SELECT atttypmod FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'vec' AND NOT attisdropped",
    []
  );
  const existingDim = rows.length ? Number(rows[0].atttypmod) : null;
  let rebuilt = false;
  if (existingDim !== null && existingDim !== d) {
    await adapter.exec("DROP INDEX IF EXISTS idx_chunks_vec");
    await adapter.exec("ALTER TABLE chunks DROP COLUMN vec");
    rebuilt = true;
  }
  if (existingDim === null || rebuilt) {
    await adapter.exec(`ALTER TABLE chunks ADD COLUMN vec vector(${d})`);
  }
  const { rows: countRows } = await adapter.query("SELECT count(*)::int AS n FROM chunks");
  if (Number(countRows[0]?.n ?? 0) > 5000) {
    await adapter.exec(
      "CREATE INDEX IF NOT EXISTS idx_chunks_vec ON chunks USING ivfflat (vec vector_cosine_ops)"
    );
  }
  return { present: true, rebuilt };
}
