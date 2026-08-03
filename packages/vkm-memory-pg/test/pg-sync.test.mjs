import test from "node:test";
import assert from "node:assert/strict";
import { ensureSchema, ensureVecColumn, metaGet } from "../src/pg-schema.mjs";
import { syncFromDump } from "../src/pg-sync.mjs";
import { vecToSqlLiteral } from "../src/fold.mjs";
import { tryOpenMemory, makeDump, vecB64 } from "./helpers.mjs";

const probe = await tryOpenMemory();
if (probe) await probe.close();
const skip = probe ? false : "PGlite WASM failed to initialize on this platform";

async function freshDb() {
  const { openAdapter } = await import("../src/pg-adapter.mjs");
  const adapter = await openAdapter({ vaultAbs: "sync-test-vault", env: { VKM_PG_MEMORY: "1" } });
  await ensureSchema(adapter);
  return adapter;
}

test("ensureSchema is idempotent (twice on the same db, no needsRebuild)", { skip }, async () => {
  const adapter = await freshDb();
  try {
    const second = await ensureSchema(adapter);
    assert.deepEqual(second, { needsRebuild: false });
    // All contract tables exist and are queryable.
    for (const t of [
      "meta",
      "notes",
      "chunks",
      "relations",
      "observations",
      "activity",
      "suggestions"
    ]) {
      const { rows } = await adapter.query(`SELECT count(*)::int AS n FROM ${t}`);
      assert.equal(typeof rows[0].n, "number");
    }
    assert.equal(await metaGet(adapter, "schema_version"), "1");
  } finally {
    await adapter.close();
  }
});

test(
  "syncFromDump applies a full fixture: notes, folded fts, chunks, relations, observations",
  { skip },
  async () => {
    const adapter = await freshDb();
    try {
      const result = await syncFromDump(adapter, makeDump());
      assert.deepEqual(result.synced, {
        notes: 3,
        chunks: 2,
        relations: 3,
        observations: 1,
        removed: 0
      });
      assert.equal(result.cursor, 300);
      assert.ok(result.tookMs >= 0);

      const { rows: notes } = await adapter.query("SELECT path, folder FROM notes ORDER BY path");
      assert.deepEqual(
        notes.map((n) => [n.path, n.folder]),
        [
          ["PRACTICES/beta.md", "PRACTICES"],
          ["PROJECTS/alpha.md", "PROJECTS"],
          ["gamma.md", ""]
        ]
      );

      // The accented body was folded, so the folded query term matches via FTS.
      const { rows: hits } = await adapter.query(
        "SELECT path FROM notes WHERE tsv @@ websearch_to_tsquery('simple', 'cancion')"
      );
      assert.deepEqual(
        hits.map((h) => h.path),
        ["PROJECTS/alpha.md"]
      );

      assert.equal(await metaGet(adapter, "embedder"), "test-embedder");
      assert.equal(await metaGet(adapter, "dim"), "8");
      assert.equal(await metaGet(adapter, "cursor_mtime_ns"), "300");
      assert.ok(await metaGet(adapter, "last_sync_at"));
    } finally {
      await adapter.close();
    }
  }
);

test("incremental update: only the changed note is rewritten", { skip }, async () => {
  const adapter = await freshDb();
  try {
    await syncFromDump(adapter, makeDump());
    const incremental = {
      ...makeDump(),
      manifest: [
        ["PROJECTS/alpha.md", 100],
        ["PRACTICES/beta.md", 200],
        ["gamma.md", 400]
      ],
      notes: [{ path: "gamma.md", title: "Gamma v2", mtime_ns: 400, size_b: 31, body: "nuevo" }],
      chunks: [],
      relations: [],
      observations: []
    };
    const result = await syncFromDump(adapter, incremental);
    assert.equal(result.synced.notes, 1);
    assert.equal(result.synced.removed, 0);
    assert.equal(result.cursor, 400);

    const { rows } = await adapter.query("SELECT title FROM notes WHERE path = 'gamma.md'");
    assert.equal(rows[0].title, "Gamma v2");
    // gamma's old structured rows were replaced by the (empty) incremental set...
    const { rows: obs } = await adapter.query(
      "SELECT count(*)::int AS n FROM observations WHERE source_path = 'gamma.md'"
    );
    assert.equal(obs[0].n, 0);
    // ...while untouched notes kept theirs.
    const { rows: rel } = await adapter.query(
      "SELECT count(*)::int AS n FROM relations WHERE source_path = 'PROJECTS/alpha.md'"
    );
    assert.equal(rel[0].n, 1);
  } finally {
    await adapter.close();
  }
});

test("manifest removal deletes a vanished note everywhere", { skip }, async () => {
  const adapter = await freshDb();
  try {
    await syncFromDump(adapter, makeDump());
    const withoutBeta = {
      ...makeDump(),
      manifest: [
        ["PROJECTS/alpha.md", 100],
        ["gamma.md", 300]
      ],
      notes: [],
      chunks: [],
      relations: [],
      observations: []
    };
    const result = await syncFromDump(adapter, withoutBeta);
    assert.equal(result.synced.removed, 1);
    const { rows } = await adapter.query("SELECT path FROM notes ORDER BY path");
    assert.deepEqual(
      rows.map((r) => r.path),
      ["PROJECTS/alpha.md", "gamma.md"]
    );
    const { rows: rel } = await adapter.query(
      "SELECT count(*)::int AS n FROM relations WHERE source_path = 'PRACTICES/beta.md'"
    );
    assert.equal(rel[0].n, 0);
  } finally {
    await adapter.close();
  }
});

test("vec column + vector search roundtrip (8-dim, cosine)", { skip }, async () => {
  const adapter = await freshDb();
  try {
    assert.equal(adapter.capabilities.vector, true, "memory:// build must load pgvector");
    await syncFromDump(adapter, makeDump());
    const probeLit = vecToSqlLiteral([1, 0, 0, 0, 0, 0, 0, 0]);
    const { rows } = await adapter.query(
      `SELECT path, (1 - (vec <=> $1::vector))::float8 AS rank
       FROM chunks WHERE vec IS NOT NULL
       ORDER BY vec <=> $1::vector`,
      [probeLit]
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].path, "PROJECTS/alpha.md"); // identical vector first
    assert.ok(Math.abs(rows[0].rank - 1) < 1e-6);
    assert.ok(rows[1].rank < rows[0].rank);
  } finally {
    await adapter.close();
  }
});

test("ensureVecColumn refuses bad dims and respects capabilities.vector", { skip }, async () => {
  const adapter = await freshDb();
  try {
    await assert.rejects(() => ensureVecColumn(adapter, 0), /invalid vector dimension/);
    const noVec = { ...adapter, capabilities: { ...adapter.capabilities, vector: false } };
    assert.deepEqual(await ensureVecColumn(noVec, 8), { present: false, rebuilt: false });
    assert.deepEqual(await ensureVecColumn(adapter, 8), { present: true, rebuilt: false });
    // Same dimension again: still no rebuild.
    assert.deepEqual(await ensureVecColumn(adapter, 8), { present: true, rebuilt: false });
  } finally {
    await adapter.close();
  }
});

test(
  "sync writes timeline activity: note_upsert rows + one sync summary, notify fires",
  { skip },
  async () => {
    const adapter = await freshDb();
    try {
      let notified = null;
      const unsubscribe = await adapter.listen("vkm_activity", (payload) => {
        notified = payload;
      });
      await syncFromDump(adapter, makeDump());
      const { rows } = await adapter.query("SELECT kind, path FROM activity ORDER BY id");
      assert.deepEqual(
        rows.map((r) => r.kind),
        ["note_upsert", "note_upsert", "note_upsert", "sync"]
      );
      const { rows: last } = await adapter.query("SELECT max(id)::int AS n FROM activity");
      // pg_notify payload is the last activity row id, as a string.
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(notified, String(last[0].n));
      await unsubscribe();
    } finally {
      await adapter.close();
    }
  }
);

test(
  "a second embedder dump for the same path does not violate the chunks PK",
  { skip },
  async () => {
    const adapter = await freshDb();
    try {
      await syncFromDump(adapter, makeDump());
      const other = {
        ...makeDump(),
        embedder: "other-embedder",
        chunks: [
          {
            path: "PROJECTS/alpha.md",
            ordinal: 0,
            heading: "intro",
            text: "canción",
            vec_b64: vecB64([0, 0, 1, 0, 0, 0, 0, 0])
          }
        ]
      };
      await syncFromDump(adapter, other); // delete+insert per changed path: no PK conflict
      const { rows } = await adapter.query(
        "SELECT embedder FROM chunks WHERE path = 'PROJECTS/alpha.md'"
      );
      assert.deepEqual(
        rows.map((r) => r.embedder),
        ["other-embedder"]
      );
    } finally {
      await adapter.close();
    }
  }
);

test(
  "syncFromDump refuses unknown schema and a missing manifest (never defaults)",
  { skip },
  async () => {
    const adapter = await freshDb();
    try {
      await assert.rejects(
        () => syncFromDump(adapter, { ...makeDump(), schema: 2 }),
        /unsupported dump schema 2/
      );
      await assert.rejects(() => syncFromDump(adapter, undefined), /unsupported dump schema/);
      const noManifest = { ...makeDump() };
      delete noManifest.manifest;
      await assert.rejects(() => syncFromDump(adapter, noManifest), /manifest is missing/);
      // A refused payload must not have touched the projection at all.
      const { rows } = await adapter.query("SELECT count(*)::int AS n FROM notes");
      assert.equal(rows[0].n, 0);
    } finally {
      await adapter.close();
    }
  }
);

test(
  "embedder dim change 8->16 rebuilds the vec column and forces a full resync",
  { skip },
  async () => {
    const adapter = await freshDb();
    try {
      await syncFromDump(adapter, makeDump()); // dim 8
      const v16 = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const dump16 = {
        ...makeDump(),
        embedder: "bigger-embedder",
        dim: 16,
        chunks: [
          {
            path: "PROJECTS/alpha.md",
            ordinal: 0,
            heading: "intro",
            text: "canción",
            vec_b64: vecB64(v16)
          }
        ]
      };
      const calls = [];
      const result = await syncFromDump(adapter, dump16, {
        vaultAbs: "sync-test-vault",
        env: {},
        runDump: async (args) => {
          calls.push(args);
          return dump16;
        }
      });
      assert.equal(result.fullResync, true);
      // The escalation was ONE full dump: no since cursor, no paths scope.
      assert.equal(calls.length, 1);
      assert.equal(calls[0].sinceMtimeNs, null);
      assert.equal(calls[0].paths, undefined);
      // The column really was rebuilt at the new dimension (pgvector atttypmod == dim).
      const { rows } = await adapter.query(
        "SELECT atttypmod FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'vec' AND NOT attisdropped"
      );
      assert.equal(Number(rows[0].atttypmod), 16);
      assert.equal(await metaGet(adapter, "dim"), "16");
      // ...and the 16-dim vectors actually landed.
      const { rows: vecs } = await adapter.query(
        "SELECT count(*)::int AS n FROM chunks WHERE vec IS NOT NULL"
      );
      assert.ok(vecs[0].n >= 1);
    } finally {
      await adapter.close();
    }
  }
);

test(
  "manifest paths outside the changed set trigger ONE follow-up --paths dump",
  { skip },
  async () => {
    const adapter = await freshDb();
    try {
      await syncFromDump(adapter, makeDump()); // cursor 300
      // delta.md entered the vault with a PRESERVED old mtime (50 < cursor): in the
      // manifest but not in the changed set. gamma.md's manifest mtime moved to 301
      // without gamma being re-shipped either (edit that never crossed the cursor).
      const incremental = {
        ...makeDump(),
        manifest: [
          ["PROJECTS/alpha.md", 100],
          ["PRACTICES/beta.md", 200],
          ["gamma.md", 301],
          ["delta.md", 50]
        ],
        notes: [],
        chunks: [],
        relations: [],
        observations: []
      };
      const followUp = {
        schema: 1,
        embedder: null,
        dim: null,
        manifest: incremental.manifest,
        notes: [
          { path: "delta.md", title: "Delta", mtime_ns: 50, size_b: 5, body: "delta body" },
          { path: "gamma.md", title: "Gamma v2", mtime_ns: 301, size_b: 30, body: "gamma v2" }
        ],
        chunks: [],
        relations: [],
        observations: []
      };
      const calls = [];
      const result = await syncFromDump(adapter, incremental, {
        vaultAbs: "sync-test-vault",
        env: {},
        runDump: async (args) => {
          calls.push(args);
          return followUp;
        }
      });
      assert.equal(calls.length, 1, "exactly ONE follow-up dump");
      assert.deepEqual([...calls[0].paths].sort(), ["delta.md", "gamma.md"]);
      assert.equal(calls[0].sinceMtimeNs, 301); // the just-committed cursor (>= filter)
      assert.deepEqual([...result.followUpPaths].sort(), ["delta.md", "gamma.md"]);
      assert.equal(result.fullResync, false);
      assert.equal(result.synced.notes, 2); // the follow-up's notes counted in
      const { rows } = await adapter.query("SELECT path, title FROM notes ORDER BY path");
      assert.deepEqual(
        rows.map((r) => [r.path, r.title]),
        [
          ["PRACTICES/beta.md", "Beta"],
          ["PROJECTS/alpha.md", "Alpha"],
          ["delta.md", "Delta"],
          ["gamma.md", "Gamma v2"]
        ]
      );
    } finally {
      await adapter.close();
    }
  }
);

test("without runDump wiring, watermark gaps are reported but not fetched", { skip }, async () => {
  const adapter = await freshDb();
  try {
    await syncFromDump(adapter, makeDump());
    const incremental = {
      ...makeDump(),
      manifest: [...makeDump().manifest, ["delta.md", 50]],
      notes: [],
      chunks: [],
      relations: [],
      observations: []
    };
    const result = await syncFromDump(adapter, incremental); // no opts: migrate's direct path
    assert.deepEqual(result.followUpPaths, ["delta.md"]);
    const { rows } = await adapter.query("SELECT count(*)::int AS n FROM notes");
    assert.equal(rows[0].n, 3, "no follow-up ran; the gap waits for the next sync");
  } finally {
    await adapter.close();
  }
});

test(
  "stale chunk rows (all older than the note's manifest mtime) are kept, not applied",
  { skip },
  async () => {
    const adapter = await freshDb();
    try {
      await syncFromDump(adapter, makeDump());
      const update = {
        ...makeDump(),
        manifest: [
          ["PROJECTS/alpha.md", 500],
          ["PRACTICES/beta.md", 200],
          ["gamma.md", 600]
        ],
        notes: [
          {
            path: "PROJECTS/alpha.md",
            title: "Alpha v2",
            mtime_ns: 500,
            size_b: 12,
            body: "nuevo cuerpo"
          },
          { path: "gamma.md", title: "Gamma v2", mtime_ns: 600, size_b: 31, body: "gamma nuevo" }
        ],
        chunks: [
          // alpha's chunks were embedded from the PREVIOUS body (mtime 100 < 500): stale.
          {
            path: "PROJECTS/alpha.md",
            ordinal: 0,
            heading: "old",
            text: "cuerpo viejo",
            mtime_ns: 100,
            vec_b64: vecB64([1, 0, 0, 0, 0, 0, 0, 0])
          },
          // gamma's chunk matches its note mtime: fresh, replaces the stored rows.
          {
            path: "gamma.md",
            ordinal: 0,
            heading: "new",
            text: "gamma chunk v2",
            mtime_ns: 600,
            vec_b64: vecB64([0, 1, 0, 0, 0, 0, 0, 0])
          }
        ],
        relations: [],
        observations: []
      };
      const result = await syncFromDump(adapter, update);
      assert.equal(result.staleChunkPaths, 1);
      // alpha kept its previously stored chunk rows...
      const { rows: alpha } = await adapter.query(
        "SELECT heading, body FROM chunks WHERE path = 'PROJECTS/alpha.md' ORDER BY ordinal"
      );
      assert.deepEqual(
        alpha.map((r) => [r.heading, r.body]),
        [["intro", "canción"]]
      );
      // ...while gamma's fresh chunks replaced the old ones.
      const { rows: gamma } = await adapter.query(
        "SELECT heading, body FROM chunks WHERE path = 'gamma.md' ORDER BY ordinal"
      );
      assert.deepEqual(
        gamma.map((r) => [r.heading, r.body]),
        [["new", "gamma chunk v2"]]
      );
      // The note bodies themselves DID update (staleness only guards chunks).
      const { rows: title } = await adapter.query(
        "SELECT title FROM notes WHERE path = 'PROJECTS/alpha.md'"
      );
      assert.equal(title[0].title, "Alpha v2");
    } finally {
      await adapter.close();
    }
  }
);

test(
  "a concurrent query during a sync sees pre- or post-sync state, never partial",
  { skip },
  async () => {
    const adapter = await freshDb();
    try {
      const N = 250;
      const manifest = [];
      const notes = [];
      for (let i = 0; i < N; i++) {
        const p = `bulk/n-${String(i).padStart(3, "0")}.md`;
        manifest.push([p, i + 1]);
        notes.push({ path: p, title: `N${i}`, mtime_ns: i + 1, size_b: 1, body: `body ${i}` });
      }
      const dump = {
        schema: 1,
        embedder: null,
        dim: null,
        manifest,
        notes,
        chunks: [],
        relations: [],
        observations: []
      };
      const syncP = syncFromDump(adapter, dump);
      // Let the transaction get going, then fire a read mid-flight. Without the adapter
      // gate this SELECT would execute INSIDE the open transaction (both backends are one
      // session) and observe a partial insert count.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const readP = adapter.query("SELECT count(*)::int AS n FROM notes");
      const [, read] = await Promise.all([syncP, readP]);
      const n = Number(read.rows[0].n);
      assert.ok(
        n === 0 || n === N,
        `concurrent read must see pre-sync (0) or post-sync (${N}) state, got ${n}`
      );
    } finally {
      await adapter.close();
    }
  }
);
