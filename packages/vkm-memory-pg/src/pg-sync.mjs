/**
 * Sync layer: `runDump` shells the Python indexer's `json-dump-index` subcommand (the FTS
 * sqlite index remains the projection's ONLY source), `syncFromDump` applies a parsed dump
 * to the adapter in a single transaction, `embedQuery` shells `json-embed-query` for
 * vector-search query embeddings.
 *
 * `syncFromDump` applies the parsed dump object directly, so tests feed handcrafted
 * fixtures and never need Python; its optional third argument wires the escalation path
 * (one follow-up dump for watermark gaps / embedder-dimension drift) via an injectable
 * `runDump`, keeping that testable with a spy too.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { throughHiddenConsole } from "@vkmikc/vkm-core/hidden-console";
import { foldText, vecToSqlLiteral, b64ToFloat32 } from "./fold.mjs";
import { ensureVecColumn, metaGet, metaSet } from "./pg-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Generous for a full dump of a large vault, bounded so a hung Python cannot leak. */
const DUMP_TIMEOUT_MS = 180_000;

/** Cap on per-note activity rows per sync — a full first sync of a 5000-note vault must
 * not write 5000 timeline rows; the `sync` summary row carries the totals regardless. */
const ACTIVITY_ROW_CAP = 200;

/** Beyond this many watermark-gap paths, a `--paths` follow-up dump would bloat the child
 * argv (Windows caps a command line around 32k chars) — one full dump is cheaper anyway. */
const MAX_FOLLOWUP_PATHS = 200;

function defaultPython(env) {
  if (env.OBSIDIAN_MEMORY_PYTHON) return env.OBSIDIAN_MEMORY_PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

function ragSrcDir() {
  return path.resolve(__dirname, "../../obsidian-memory-rag/src");
}

async function runPythonJson(args, env) {
  const py = defaultPython(env);
  const childEnv = { ...env };
  childEnv.PYTHONPATH = [ragSrcDir(), env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  const launch = throughHiddenConsole(py, ["-m", "obsidian_memory_rag", ...args]);
  const r = await execa(launch.command, launch.args, {
    env: childEnv,
    reject: false,
    stripFinalNewline: true,
    windowsHide: launch.windowsHide,
    timeout: DUMP_TIMEOUT_MS
  });
  if (r.timedOut) {
    throw new Error(`obsidian_memory_rag ${args[0]} timed out after ${DUMP_TIMEOUT_MS}ms`);
  }
  if (r.exitCode !== 0) {
    const detail = r.stderr || r.shortMessage || r.stdout || "(no output)";
    throw new Error(`obsidian_memory_rag ${args[0]} exited ${r.exitCode ?? "?"}: ${detail}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new Error(
      `obsidian_memory_rag ${args[0]} returned non-JSON output: ${String(r.stdout).slice(0, 300)}`,
      { cause: e }
    );
  }
}

/**
 * Shell `python -m obsidian_memory_rag json-dump-index` and parse the single-line JSON.
 * @param {{ vaultAbs: string, sinceMtimeNs?: number | string | null, includeVectors?: boolean,
 *   paths?: string[] | null, env?: NodeJS.ProcessEnv }} opts - `paths`: vault-relative note
 *   paths ALWAYS included in the changed set on top of the since filter (the frozen
 *   `--paths` contract; the consumer's targeted follow-up dump rides on it).
 * @returns {Promise<any>} the dump-wire object (schema 1)
 */
export async function runDump({
  vaultAbs,
  sinceMtimeNs,
  includeVectors = true,
  paths = null,
  env = process.env
}) {
  const args = ["json-dump-index", "--vault", path.resolve(vaultAbs)];
  if (sinceMtimeNs !== undefined && sinceMtimeNs !== null) {
    args.push("--since-mtime-ns", String(sinceMtimeNs));
  }
  if (Array.isArray(paths) && paths.length > 0) {
    args.push("--paths", paths.join(","));
  }
  if (includeVectors) args.push("--include-vectors");
  return runPythonJson(args, env);
}

/**
 * Shell `python -m obsidian_memory_rag json-embed-query` for a query embedding.
 * Returns the wire object — either `{embedder,dim,vec_b64}` or `{error}` (exit 0 by
 * contract when no vectors exist on disk).
 * @param {{ vaultAbs: string, query: string, embedder?: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {Promise<{ embedder?: string, dim?: number, vec_b64?: string, error?: string }>}
 */
export async function embedQuery({ vaultAbs, query, embedder, env = process.env }) {
  const args = ["json-embed-query", "--vault", path.resolve(vaultAbs), "--query", query];
  if (embedder) args.push("--embedder", embedder);
  return runPythonJson(args, env);
}

/** Folder = the first path segment of a nested note, "" for a vault-root note. */
function folderOf(relPath) {
  const p = String(relPath).replace(/\\/g, "/");
  const i = p.indexOf("/");
  return i > 0 ? p.slice(0, i) : "";
}

/** Refuse rather than default: dump.py's wire contract promises the consumer rejects
 * payloads it does not understand — a defaulted-empty manifest would read as "every note
 * was deleted" and silently wipe the whole projection. */
function assertDumpShape(dump) {
  if (dump?.schema !== 1) {
    throw new Error(
      `unsupported dump schema ${JSON.stringify(dump?.schema ?? null)} (expected 1) — refusing to sync`
    );
  }
  if (!Array.isArray(dump.manifest)) {
    throw new Error("invalid dump: manifest is missing or not an array — refusing to sync");
  }
}

/**
 * Paths whose incoming chunk rows are ALL strictly older than the note's manifest mtime:
 * vectors refresh lazily (`ensure_fresh` on query, never during a dump), so a
 * watcher-triggered dump can ship a fresh note body alongside chunks built from the
 * PREVIOUS body. Replacing the stored rows with those would move the projection backwards
 * — keep the existing rows instead and surface the count as `staleChunkPaths`. A chunk
 * without its own `mtime_ns` (older producer) counts as fresh: its comparison is
 * `NaN < x` = false, so the path never classifies as stale.
 * @param {any[]} chunks
 * @param {Map<string, number>} manifestMtime
 * @returns {Set<string>}
 */
function staleChunkPathsOf(chunks, manifestMtime) {
  /** @type {Map<string, any[]>} */
  const byPath = new Map();
  for (const c of chunks) {
    const p = String(c.path);
    const list = byPath.get(p);
    if (list) list.push(c);
    else byPath.set(p, [c]);
  }
  const stale = new Set();
  for (const [p, rows] of byPath) {
    const noteMtime = manifestMtime.get(p);
    if (noteMtime === undefined) continue;
    const allStale = rows.every((c) => {
      const v = c.mtime_ns === undefined || c.mtime_ns === null ? NaN : Number(c.mtime_ns);
      return v < noteMtime;
    });
    if (allStale) stale.add(p);
  }
  return stale;
}

/**
 * Validate a parsed json-dump-index object and apply it to the projection in ONE
 * transaction, held under the adapter's `withLock` gate so concurrent adapter callers
 * (the service's HTTP reads) see strictly pre- or post-sync state, never the middle.
 *
 * - refuses payloads it does not understand (`schema !== 1`, manifest not an array)
 * - upserts `notes` for every dump note (body_fold = foldText(title + "\n" + body))
 * - delete+insert `chunks`/`relations`/`observations` for the changed path set; a path
 *   whose incoming chunks are ALL older than its manifest mtime keeps its stored chunks
 *   (the dump raced the lazy vector refresh — see `staleChunkPathsOf`)
 * - manifest diff: paths present in PG but absent from the manifest are removed everywhere
 * - meta: cursor_mtime_ns (max mtime over the FULL manifest), last_sync_at, embedder, dim
 * - activity: one `note_upsert` row per changed path (capped at 200) + one `sync` summary
 *   row, then `notify("vkm_activity", lastActivityId)` after commit
 *
 * Escalation (runs only when `opts.vaultAbs` + `opts.runDump` are wired; otherwise the
 * returned flags still report what was detected):
 * - embedder-dimension drift (stored meta `dim` differs, or the vec column was rebuilt)
 *   wiped every stored vector, so ONE follow-up FULL dump restores them (`fullResync`)
 * - manifest paths whose stored `notes.mtime_ns` is missing or different and that this
 *   dump's changed set did not cover (a file that entered the vault with a preserved old
 *   mtime, an edit that never crossed the cursor) get ONE follow-up `runDump({ paths })`
 * A gap that survives the single follow-up (e.g. a file touched mid-sync) is caught by
 * the next incremental sync — never by recursing here.
 *
 * @param {import("./pg-adapter.mjs").PgAdapter} adapter
 * @param {any} dump - parsed json-dump-index wire object
 * @param {{ vaultAbs?: string, env?: NodeJS.ProcessEnv, runDump?: typeof runDump }} [opts]
 * @returns {Promise<{ synced: { notes: number, chunks: number, relations: number,
 *   observations: number, removed: number }, cursor: number, tookMs: number,
 *   staleChunkPaths: number, fullResync: boolean, followUpPaths: string[] }>}
 */
export async function syncFromDump(adapter, dump, opts = {}) {
  const t0 = Date.now();
  assertDumpShape(dump);

  const first = await applyDump(adapter, dump);
  const synced = { ...first.synced };
  let cursor = first.cursor;
  let staleChunkPaths = first.staleChunkPaths;
  const fullResync = first.dimDrift;
  const followUpPaths = first.mismatchedPaths;

  const doDump = typeof opts.runDump === "function" && opts.vaultAbs ? opts.runDump : null;
  let followUp = null;
  if (doDump && fullResync) {
    // Dim drift rebuilt the vec column, wiping vectors for every path this dump did not
    // ship — only a full dump can restore them.
    followUp = await doDump({
      vaultAbs: opts.vaultAbs,
      sinceMtimeNs: null,
      includeVectors: true,
      env: opts.env ?? process.env
    });
  } else if (doDump && followUpPaths.length > MAX_FOLLOWUP_PATHS) {
    followUp = await doDump({
      vaultAbs: opts.vaultAbs,
      sinceMtimeNs: null,
      includeVectors: true,
      env: opts.env ?? process.env
    });
  } else if (doDump && followUpPaths.length > 0) {
    followUp = await doDump({
      vaultAbs: opts.vaultAbs,
      // The producer filter is `mtime_ns >= since`, so passing the just-committed cursor
      // re-includes at most the cursor-tied note — a harmless idempotent upsert.
      sinceMtimeNs: cursor,
      paths: followUpPaths,
      includeVectors: true,
      env: opts.env ?? process.env
    });
  }

  if (followUp !== null) {
    assertDumpShape(followUp);
    const second = await applyDump(adapter, followUp);
    for (const k of Object.keys(synced)) synced[k] += second.synced[k];
    cursor = second.cursor;
    staleChunkPaths += second.staleChunkPaths;
  }

  return { synced, cursor, tookMs: Date.now() - t0, staleChunkPaths, fullResync, followUpPaths };
}

/**
 * Run one dump application with exclusive DB access. Real adapters (from `openAdapter`)
 * expose `withLock`; bare test fakes may not — fall back to direct execution there, where
 * there is no concurrent traffic by construction.
 * @param {import("./pg-adapter.mjs").PgAdapter} adapter
 * @param {any} dump
 */
async function applyDump(adapter, dump) {
  const run = (a) => applyDumpOn(a, dump);
  return typeof adapter.withLock === "function" ? adapter.withLock(run) : run(adapter);
}

/**
 * The single-transaction dump application (see `syncFromDump` for the contract). `a` is
 * the RAW backend, already held exclusively by the caller.
 * @param {import("./pg-adapter.mjs").PgAdapter} a
 * @param {any} dump
 * @returns {Promise<{ synced: { notes: number, chunks: number, relations: number,
 *   observations: number, removed: number }, cursor: number, staleChunkPaths: number,
 *   mismatchedPaths: string[], dimDrift: boolean }>}
 */
async function applyDumpOn(a, dump) {
  const notes = Array.isArray(dump.notes) ? dump.notes : [];
  const chunks = Array.isArray(dump.chunks) ? dump.chunks : [];
  const relations = Array.isArray(dump.relations) ? dump.relations : [];
  const observations = Array.isArray(dump.observations) ? dump.observations : [];
  const manifest = dump.manifest;
  const embedder = typeof dump.embedder === "string" ? dump.embedder : null;
  const dim = Number.isInteger(dump.dim) ? dump.dim : null;

  const changed = new Set(notes.map((n) => String(n.path)));
  /** Manifest mtimes Number-coerced ONCE — every comparison below is double vs double. */
  const manifestMtime = new Map(manifest.map((m) => [String(m[0]), Number(m[1])]));

  // Embedder-dimension drift: compare the incoming dim against the stored meta dim, and
  // let ensureVecColumn also report a column rebuild (belt and braces — the meta row can
  // lag a manually altered column). Either signal means previously synced vectors are
  // gone and only a full resync restores them.
  const storedDimRaw = await metaGet(a, "dim");
  const hasVectors = dim !== null && chunks.some((c) => typeof c.vec_b64 === "string");
  let dimDrift = hasVectors && storedDimRaw !== null && Number(storedDimRaw) !== dim;
  let withVec = false;
  if (hasVectors) {
    const vec = await ensureVecColumn(a, dim);
    withVec = vec.present;
    dimDrift = dimDrift || vec.rebuilt;
  }

  const staleChunkSet = staleChunkPathsOf(chunks, manifestMtime);

  let removed = 0;
  let lastActivityId;
  /** @type {string[]} */
  const mismatchedPaths = [];

  await a.exec("BEGIN");
  try {
    for (const n of notes) {
      const bodyFold = foldText(`${n.title ?? ""}\n${n.body ?? ""}`);
      await a.query(
        `INSERT INTO notes(path, title, mtime_ns, size_b, folder, body_fold)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (path) DO UPDATE SET
           title = EXCLUDED.title, mtime_ns = EXCLUDED.mtime_ns, size_b = EXCLUDED.size_b,
           folder = EXCLUDED.folder, body_fold = EXCLUDED.body_fold`,
        [
          String(n.path),
          String(n.title ?? ""),
          String(n.mtime_ns ?? 0),
          String(n.size_b ?? 0),
          folderOf(n.path),
          bodyFold
        ]
      );
    }

    for (const p of changed) {
      if (!staleChunkSet.has(p)) await a.query("DELETE FROM chunks WHERE path = $1", [p]);
      await a.query("DELETE FROM relations WHERE source_path = $1", [p]);
      await a.query("DELETE FROM observations WHERE source_path = $1", [p]);
    }

    for (const c of chunks) {
      if (staleChunkSet.has(String(c.path))) continue;
      if (withVec && typeof c.vec_b64 === "string") {
        await a.query(
          `INSERT INTO chunks(path, ordinal, embedder, heading, body, vec)
           VALUES ($1, $2, $3, $4, $5, $6::vector)`,
          [
            String(c.path),
            Number(c.ordinal),
            embedder ?? "",
            String(c.heading ?? ""),
            String(c.text ?? ""),
            vecToSqlLiteral(b64ToFloat32(c.vec_b64))
          ]
        );
      } else {
        await a.query(
          `INSERT INTO chunks(path, ordinal, embedder, heading, body)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            String(c.path),
            Number(c.ordinal),
            embedder ?? "",
            String(c.heading ?? ""),
            String(c.text ?? "")
          ]
        );
      }
    }

    for (const r of relations) {
      await a.query(
        `INSERT INTO relations(source_path, relation_type, target, context)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_path, relation_type, target) DO UPDATE SET context = EXCLUDED.context`,
        [String(r.source_path), String(r.relation_type), String(r.target), String(r.context ?? "")]
      );
    }

    for (const o of observations) {
      await a.query(
        `INSERT INTO observations(source_path, ordinal, category, content, tags)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_path, ordinal) DO UPDATE SET
           category = EXCLUDED.category, content = EXCLUDED.content, tags = EXCLUDED.tags`,
        [
          String(o.source_path),
          Number(o.ordinal),
          String(o.category),
          String(o.content),
          Array.isArray(o.tags) ? o.tags.map(String) : []
        ]
      );
    }

    // Manifest diff: the manifest is ALWAYS every indexed row, so anything in PG that is
    // not in it was deleted from the vault (or de-indexed) and must leave the projection.
    const { rows: existing } = await a.query("SELECT path, mtime_ns FROM notes", []);
    /** @type {Map<string, number>} */
    const storedMtime = new Map(existing.map((r) => [String(r.path), Number(r.mtime_ns)]));
    for (const [p] of storedMtime) {
      if (!manifestMtime.has(p)) {
        await a.query("DELETE FROM notes WHERE path = $1", [p]);
        await a.query("DELETE FROM chunks WHERE path = $1", [p]);
        await a.query("DELETE FROM relations WHERE source_path = $1", [p]);
        await a.query("DELETE FROM observations WHERE source_path = $1", [p]);
        removed += 1;
      }
    }

    // Watermark-gap diff: a file can enter the vault with an mtime at or below the cursor
    // (mtime-preserving sync tools, `cp -p`, restores) or change without crossing it —
    // the manifest always carries every [path, mtime_ns], so any path whose stored mtime
    // is missing or different, and that this dump's changed set did not cover, needs a
    // follow-up fetch (syncFromDump issues it). Both sides were coerced through Number():
    // the same on-disk mtime yields the SAME double on both routes (JSON.parse here;
    // JSON.parse -> String -> bigint -> Number for the stored row — doubles round-trip
    // through their decimal string exactly), so equal-after-rounding counts as equal and
    // rounding can never fabricate a mismatch.
    for (const [p, m] of manifestMtime) {
      if (changed.has(p)) continue;
      const stored = storedMtime.get(p);
      if (stored === undefined || stored !== m) mismatchedPaths.push(p);
    }

    // Cursor = Number(max mtime over the FULL manifest). mtime_ns values (~1.7e18) exceed
    // 2^53, so Number() rounds by up to ~hundreds of ns — possibly ABOVE the true max.
    // Harmless by construction: the producer's changed-set filter is `mtime_ns >= since`
    // (a re-sent cursor-tied note is an idempotent upsert), and the watermark-gap diff
    // above re-fetches any note a too-high cursor would otherwise skip.
    let cursor = 0;
    for (const m of manifestMtime.values()) {
      if (Number.isFinite(m) && m > cursor) cursor = m;
    }
    await metaSet(a, "cursor_mtime_ns", String(cursor));
    await metaSet(a, "last_sync_at", new Date().toISOString());
    if (embedder !== null) await metaSet(a, "embedder", embedder);
    if (dim !== null) await metaSet(a, "dim", String(dim));

    const synced = {
      notes: notes.length,
      chunks: chunks.length,
      relations: relations.length,
      observations: observations.length,
      removed
    };

    let upsertRows = 0;
    for (const p of changed) {
      if (upsertRows >= ACTIVITY_ROW_CAP) break;
      await a.query(
        "INSERT INTO activity(kind, path, detail) VALUES ('note_upsert', $1, '{}'::jsonb)",
        [p]
      );
      upsertRows += 1;
    }
    const { rows: act } = await a.query(
      "INSERT INTO activity(kind, path, detail) VALUES ('sync', NULL, $1::jsonb) RETURNING id",
      [JSON.stringify(synced)]
    );
    lastActivityId = act[0]?.id ?? null;

    await a.exec("COMMIT");

    if (lastActivityId !== null && lastActivityId !== undefined) {
      try {
        await a.notify("vkm_activity", String(lastActivityId));
      } catch {
        // notify is a live-update nicety; the committed sync must not fail because of it
      }
    }

    return {
      synced,
      cursor,
      staleChunkPaths: staleChunkSet.size,
      mismatchedPaths,
      dimDrift
    };
  } catch (e) {
    try {
      await a.exec("ROLLBACK");
    } catch {
      // connection-level failure — nothing to roll back on
    }
    throw e;
  }
}
