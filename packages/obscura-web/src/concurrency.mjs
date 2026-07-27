/**
 * Bounded-parallelism helper, shared by everything in this package that fans out.
 *
 * Lived inside `research.mjs` until the batch-fetch handler in `obscura-mcp.mjs`
 * hand-rolled the same loop a second time (same `next++` claim, same input-order
 * `out` array, same `Promise.all` over N workers) — but without the deadline and
 * stop-early gates, which is exactly the difference that matters under a wall
 * clock. `research.mjs` is not the natural owner of a generic pool, so it lives
 * here and both import it.
 *
 * @module
 */

/**
 * Map `fn` over `items` with at most `limit` in flight, preserving INPUT order in the
 * output. Order matters: candidates arrive best-first and the response must not
 * silently reshuffle to whatever finished first. Never rejects — `fn` is expected to
 * encode its own failures.
 *
 * `deadline` (an epoch ms) stops workers from PICKING UP new items; unstarted slots come
 * back `undefined`, which the caller reports rather than hides. This function itself never
 * cancels an ALREADY-claimed item — `fn` runs to whatever completion it has. A caller for
 * whom that is not tight enough (fetch+curate, where a single item's own internal timeouts
 * can be tens of seconds) wraps its own `fn` in a race against the remaining deadline; a
 * caller whose per-item work is already short and self-bounded (the SearXNG gather loop,
 * each call capped at 10s in serp.mjs) can safely rely on just this gate.
 *
 * `stopWhen` is the same kind of gate as `deadline`, checked at the same point (before
 * picking up a new item, never cancelling one already claimed), but driven by an arbitrary
 * predicate instead of the clock — e.g. "stop once enough GOOD results have come back", so
 * a call that already has what it needs doesn't keep grinding through the rest of `topK`
 * just because time remains.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit max concurrent invocations
 * @param {(item: T, index: number) => Promise<R> | R} fn
 * @param {{ deadline?: number, now?: () => number, stopWhen?: (() => boolean) | null }} [opts]
 * @returns {Promise<(R | undefined)[]>} input-ordered results; `undefined` where a slot was gated
 */
export async function mapWithConcurrency(
  items,
  limit,
  fn,
  { deadline = 0, now = Date.now, stopWhen = null } = {}
) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      if (deadline && now() >= deadline) return;
      if (stopWhen && stopWhen()) return;
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
