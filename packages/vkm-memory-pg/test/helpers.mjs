/**
 * Shared fixtures for the PGlite-backed tests. `tryOpenMemory` probes whether the WASM
 * runtime initializes on this platform — tests skip LOUDLY (node:test `skip`) instead of
 * failing where it cannot.
 */

/**
 * @returns {Promise<import("../src/pg-adapter.mjs").PgAdapter | null>} a live memory://
 *   adapter, or null when PGlite cannot initialize here.
 */
export async function tryOpenMemory() {
  try {
    const { openAdapter } = await import("../src/pg-adapter.mjs");
    return await openAdapter({ vaultAbs: "probe-vault", env: { VKM_PG_MEMORY: "1" } });
  } catch {
    return null;
  }
}

/** base64(float32 LE) — the dump-wire vector encoding. */
export function vecB64(arr) {
  const buf = Buffer.alloc(arr.length * 4);
  arr.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf.toString("base64");
}

/** A handcrafted json-dump-index fixture: 3 notes, 8-dim vectors, a relation cycle. */
export function makeDump() {
  return {
    schema: 1,
    embedder: "test-embedder",
    dim: 8,
    manifest: [
      ["PROJECTS/alpha.md", 100],
      ["PRACTICES/beta.md", 200],
      ["gamma.md", 300]
    ],
    notes: [
      {
        path: "PROJECTS/alpha.md",
        title: "Alpha",
        mtime_ns: 100,
        size_b: 10,
        body: "Canción sobre beta"
      },
      { path: "PRACTICES/beta.md", title: "Beta", mtime_ns: 200, size_b: 20, body: "beta body" },
      { path: "gamma.md", title: "Gamma", mtime_ns: 300, size_b: 30, body: "gamma body" }
    ],
    chunks: [
      {
        path: "PROJECTS/alpha.md",
        ordinal: 0,
        heading: "intro",
        text: "canción",
        vec_b64: vecB64([1, 0, 0, 0, 0, 0, 0, 0])
      },
      {
        path: "gamma.md",
        ordinal: 0,
        heading: "",
        text: "gamma chunk",
        vec_b64: vecB64([0, 1, 0, 0, 0, 0, 0, 0])
      }
    ],
    relations: [
      {
        source_path: "PROJECTS/alpha.md",
        relation_type: "implements",
        target: "practices/beta",
        context: ""
      },
      {
        source_path: "PRACTICES/beta.md",
        relation_type: "relates_to",
        target: "gamma",
        context: ""
      },
      {
        source_path: "gamma.md",
        relation_type: "relates_to",
        target: "projects/alpha.md",
        context: "cycle edge"
      }
    ],
    observations: [
      { source_path: "gamma.md", ordinal: 0, category: "decision", content: "use pg", tags: ["pg"] }
    ],
    count: { notes: 3, chunks: 2, relations: 3, observations: 1 }
  };
}
