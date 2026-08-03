/**
 * Typed-relation graph traversal over the projection, as SQL (`WITH RECURSIVE`) instead of
 * N round-trips per hop.
 *
 * Target resolution mirrors the practical subset of kg_query.py / graphlink.py's
 * Obsidian-style resolver: a relation's `target` is a normalized wikilink key (lowercase,
 * no `.md`), a note's `path` is the real relpath (case preserved, with `.md`) — so a
 * target matches (1) the full relpath compared case-insensitively with `.md` stripped from
 * both sides, else (2) by basename stem, ambiguity resolved deterministically
 * (lexicographically first, same as `_build_resolver`). Unresolvable targets stay in the
 * graph as leaf nodes named by their raw target key — a dangling link is information.
 *
 * Scope (frozen scoped-memory contract): when a scope is given, BOTH the seed and every
 * traversed edge are restricted to it — an edge survives only when its source_path AND its
 * resolved target both sit inside the scope, so a scoped traversal can never step outside
 * the namespace and back in. Callers validate the scope; here it is only a bind parameter.
 */
import { scopeMatchSql, pathInScope } from "./scope.mjs";

const DIRECTIONS = new Set(["out", "in", "both"]);
const MAX_DEPTH = 4;
const DEFAULT_LIMIT = 500;

/** The target-resolution CTE shared by graphHops and fullGraph. */
const RESOLVED_CTE = `
  SELECT r.source_path, r.relation_type, r.target,
    COALESCE(
      (SELECT n.path FROM notes n
        WHERE regexp_replace(lower(n.path), '\\.md$', '') =
              regexp_replace(lower(r.target), '\\.md$', '')
        ORDER BY n.path LIMIT 1),
      (SELECT n.path FROM notes n
        WHERE regexp_replace(regexp_replace(lower(n.path), '.*/', ''), '\\.md$', '') =
              regexp_replace(regexp_replace(lower(r.target), '.*/', ''), '\\.md$', '')
        ORDER BY n.path LIMIT 1),
      r.target
    ) AS target_node
  FROM relations r`;

function stepArms(direction) {
  const out =
    "SELECT source_path AS from_node, target_node AS to_node, source_path, relation_type, target_node FROM scoped";
  const inn =
    "SELECT target_node AS from_node, source_path AS to_node, source_path, relation_type, target_node FROM scoped";
  if (direction === "out") return out;
  if (direction === "in") return inn;
  return `${out} UNION ALL ${inn}`;
}

/** Look up titles for a set of node paths; unresolved nodes fall back to their stem. */
async function nodesFor(adapter, paths) {
  if (paths.length === 0) return [];
  const { rows } = await adapter.query(
    "SELECT path, title FROM notes WHERE path = ANY($1::text[])",
    [paths]
  );
  const titles = new Map(rows.map((r) => [String(r.path), String(r.title)]));
  return paths.map((p) => ({
    path: p,
    title: titles.get(p) || String(p).replace(/^.*\//, "").replace(/\.md$/i, "")
  }));
}

/**
 * Multi-hop traversal from one note.
 * @param {import("./pg-adapter.mjs").PgAdapter} adapter
 * @param {{ from: string, depth?: number, direction?: "out"|"in"|"both",
 *   types?: string[] | null, limit?: number, scope?: string | null }} opts - `from` is a
 *   rel path WITH `.md`; `scope` (already validated by the caller) restricts the seed and
 *   every traversed edge to that namespace.
 * @returns {Promise<{ nodes: { path: string, title: string }[],
 *   edges: { source: string, type: string, target: string, depth: number }[] }>}
 */
export async function graphHops(
  adapter,
  { from, depth = 1, direction = "both", types, limit, scope = null }
) {
  if (!from || typeof from !== "string") throw new Error("graphHops: 'from' is required");
  const d = Math.min(Math.max(Number(depth) || 1, 1), MAX_DEPTH);
  const dir = DIRECTIONS.has(direction) ? direction : "both";
  const lim = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  const typeArr = Array.isArray(types) && types.length ? types.map(String) : null;
  const scopeVal = scope || null;
  // An out-of-scope seed can reach nothing: every scoped edge has BOTH endpoints inside
  // the scope, so no edge's from_node can equal the seed. Skip the query entirely — and
  // do not leak the seed itself as a node.
  if (scopeVal !== null && !pathInScope(from, scopeVal)) return { nodes: [], edges: [] };

  const sql = `
    WITH RECURSIVE resolved AS (${RESOLVED_CTE}
      WHERE ($3::text[] IS NULL OR r.relation_type = ANY($3::text[]))
    ),
    scoped AS (
      SELECT source_path, relation_type, target_node FROM resolved
      WHERE $5::text IS NULL
         OR (${scopeMatchSql("source_path", 5)} AND ${scopeMatchSql("target_node", 5)})
    ),
    step AS (${stepArms(dir)}),
    hops AS (
      SELECT s.source_path, s.relation_type, s.target_node, s.to_node, 1 AS depth,
             ARRAY[$1::text, s.to_node] AS visited
      FROM step s WHERE s.from_node = $1
      UNION ALL
      SELECT s.source_path, s.relation_type, s.target_node, s.to_node, h.depth + 1,
             h.visited || s.to_node
      FROM step s JOIN hops h ON s.from_node = h.to_node
      WHERE h.depth < $2 AND NOT (s.to_node = ANY(h.visited))
    )
    SELECT DISTINCT source_path, relation_type, target_node, depth
    FROM hops
    ORDER BY depth, source_path, relation_type, target_node
    LIMIT $4`;

  const { rows } = await adapter.query(sql, [from, d, typeArr, lim, scopeVal]);
  const edges = rows.map((r) => ({
    source: String(r.source_path),
    type: String(r.relation_type),
    target: String(r.target_node),
    depth: Number(r.depth)
  }));
  const nodePaths = new Set([from]);
  for (const e of edges) {
    nodePaths.add(e.source);
    nodePaths.add(e.target);
  }
  return { nodes: await nodesFor(adapter, [...nodePaths].sort()), edges };
}

/**
 * The whole resolved graph, capped.
 * @param {import("./pg-adapter.mjs").PgAdapter} adapter
 * @param {number} [limit] - max edges (default 500)
 * @param {string | null} [scope] - already-validated scope; edges survive only when both
 *   endpoints sit inside it
 * @returns {Promise<{ nodes: { path: string, title: string }[],
 *   edges: { source: string, type: string, target: string, depth: number }[] }>}
 */
export async function fullGraph(adapter, limit = DEFAULT_LIMIT, scope = null) {
  const lim = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  const scopeVal = scope || null;
  const { rows } = await adapter.query(
    `WITH resolved AS (${RESOLVED_CTE})
     SELECT source_path, relation_type, target_node
     FROM resolved
     WHERE $2::text IS NULL
        OR (${scopeMatchSql("source_path", 2)} AND ${scopeMatchSql("target_node", 2)})
     ORDER BY source_path, relation_type, target_node
     LIMIT $1`,
    [lim, scopeVal]
  );
  const edges = rows.map((r) => ({
    source: String(r.source_path),
    type: String(r.relation_type),
    target: String(r.target_node),
    depth: 1
  }));
  const nodePaths = new Set();
  for (const e of edges) {
    nodePaths.add(e.source);
    nodePaths.add(e.target);
  }
  return { nodes: await nodesFor(adapter, [...nodePaths].sort()), edges };
}
