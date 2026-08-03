import test from "node:test";
import assert from "node:assert/strict";
import { ensureSchema } from "../src/pg-schema.mjs";
import { syncFromDump } from "../src/pg-sync.mjs";
import { graphHops, fullGraph } from "../src/graph-query.mjs";
import { tryOpenMemory, makeDump } from "./helpers.mjs";

const probe = await tryOpenMemory();
if (probe) await probe.close();
const skip = probe ? false : "PGlite WASM failed to initialize on this platform";

async function seededDb() {
  const { openAdapter } = await import("../src/pg-adapter.mjs");
  const adapter = await openAdapter({ vaultAbs: "graph-test-vault", env: { VKM_PG_MEMORY: "1" } });
  await ensureSchema(adapter);
  // Fixture graph (targets exercise every resolver form):
  //   alpha -implements-> beta   (path-qualified, no .md)
  //   beta  -relates_to-> gamma  (bare basename)
  //   gamma -relates_to-> alpha  (path-qualified WITH .md) — closes the cycle
  await syncFromDump(adapter, makeDump());
  return adapter;
}

test(
  "graphHops depth 2, direction out: resolves path, basename and .md targets",
  { skip },
  async () => {
    const adapter = await seededDb();
    try {
      const g = await graphHops(adapter, { from: "PROJECTS/alpha.md", depth: 2, direction: "out" });
      assert.deepEqual(g.edges, [
        { source: "PROJECTS/alpha.md", type: "implements", target: "PRACTICES/beta.md", depth: 1 },
        { source: "PRACTICES/beta.md", type: "relates_to", target: "gamma.md", depth: 2 }
      ]);
      assert.deepEqual(
        g.nodes.map((n) => [n.path, n.title]),
        [
          ["PRACTICES/beta.md", "Beta"],
          ["PROJECTS/alpha.md", "Alpha"],
          ["gamma.md", "Gamma"]
        ]
      );
    } finally {
      await adapter.close();
    }
  }
);

test(
  "cycle safety: depth 4 over the alpha->beta->gamma->alpha cycle terminates",
  { skip },
  async () => {
    const adapter = await seededDb();
    try {
      const g = await graphHops(adapter, { from: "PROJECTS/alpha.md", depth: 4, direction: "out" });
      // The visited array blocks the return to alpha, so exactly the two forward edges
      // survive plus gamma->alpha discovered at depth 3 is suppressed (alpha is visited).
      assert.equal(g.edges.length, 2);
      assert.ok(g.edges.every((e) => e.depth <= 4));
    } finally {
      await adapter.close();
    }
  }
);

test("direction in: who points at beta", { skip }, async () => {
  const adapter = await seededDb();
  try {
    const g = await graphHops(adapter, { from: "PRACTICES/beta.md", depth: 1, direction: "in" });
    assert.deepEqual(g.edges, [
      { source: "PROJECTS/alpha.md", type: "implements", target: "PRACTICES/beta.md", depth: 1 }
    ]);
  } finally {
    await adapter.close();
  }
});

test("types filter narrows the traversal to the named verbs", { skip }, async () => {
  const adapter = await seededDb();
  try {
    const g = await graphHops(adapter, {
      from: "PROJECTS/alpha.md",
      depth: 4,
      direction: "both",
      types: ["implements"]
    });
    assert.deepEqual(g.edges, [
      { source: "PROJECTS/alpha.md", type: "implements", target: "PRACTICES/beta.md", depth: 1 }
    ]);
  } finally {
    await adapter.close();
  }
});

test("unresolvable target stays in the graph as a dangling leaf node", { skip }, async () => {
  const adapter = await seededDb();
  try {
    await adapter.query(
      "INSERT INTO relations(source_path, relation_type, target, context) VALUES ($1,$2,$3,$4)",
      ["gamma.md", "uses", "does-not-exist", ""]
    );
    const g = await graphHops(adapter, { from: "gamma.md", depth: 1, direction: "out" });
    const dangling = g.edges.find((e) => e.type === "uses");
    assert.ok(dangling);
    assert.equal(dangling.target, "does-not-exist");
    const node = g.nodes.find((n) => n.path === "does-not-exist");
    assert.ok(node, "dangling target appears as a node");
    assert.equal(node.title, "does-not-exist"); // stem fallback title
  } finally {
    await adapter.close();
  }
});

test("depth is clamped to the 1..4 contract range", { skip }, async () => {
  const adapter = await seededDb();
  try {
    const g = await graphHops(adapter, { from: "PROJECTS/alpha.md", depth: 99, direction: "out" });
    assert.ok(g.edges.every((e) => e.depth <= 4));
    const g1 = await graphHops(adapter, { from: "PROJECTS/alpha.md", depth: 0, direction: "out" });
    assert.ok(g1.edges.every((e) => e.depth === 1));
  } finally {
    await adapter.close();
  }
});

test("fullGraph returns the whole resolved edge set, capped by limit", { skip }, async () => {
  const adapter = await seededDb();
  try {
    const all = await fullGraph(adapter);
    assert.equal(all.edges.length, 3);
    assert.ok(all.nodes.length >= 3);
    const capped = await fullGraph(adapter, 2);
    assert.equal(capped.edges.length, 2);
  } finally {
    await adapter.close();
  }
});
