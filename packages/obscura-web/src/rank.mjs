/**
 * Rank fusion for the research pipeline. Pure functions, no I/O, no dependencies.
 *
 * Ported from the vault RAG's `query.py` (`reciprocal_rank_fusion` at :256-277) rather than
 * imported: obscura-web stays independently runnable with no cross-workspace runtime
 * dependency (ADR-0051 §6, the same call already made for `toolHandler`, the injection
 * scanner and the Ollama client). The port is ~20 lines; a dependency on a Python package
 * behind a monorepo-layout assumption would cost far more than it saves.
 *
 * ── Measured: for a SINGLE query, the best ranker is no ranker ───────────────────────────
 *
 * On evals/research (n=10, k=10, frozen fixtures), every arm that adds cleverness on top of
 * the order SearXNG already delivers measured WORSE than leaving it alone:
 *
 *   arm                  recall@10  MRR    hit@1  nDCG@10   what it does
 *   today (slice+BM25)     0.700    0.371  0.300   0.445    ships today
 *   no-slice-bm25          0.400    0.237  0.200   0.275    BM25 over the full pool
 *   searxng-score-sort     0.600    0.500  0.400   0.526    re-sort by raw `score`
 *   rrf-fused (w=0.3)      0.600    0.417  0.300   0.463    RRF(searxng, bm25)
 *   searxng-json-order     0.700    0.514  0.400   0.560    <- do nothing
 *
 * A BM25_WEIGHT sweep over {0, .1, .2, .3, .5, .75, 1, 1.5} is monotonically decreasing in
 * nDCG (0.526 -> 0.405): BM25's optimal fusion weight against this golden set is exactly 0.
 * So `fuseCandidates` was written, measured, and deleted rather than shipped at a weight the
 * data says is zero. This file keeps only what earned its place.
 *
 * Two things worth not re-learning the hard way:
 *
 *  1. `no-slice-bm25` is the WORST arm — worse than today. The `PAGE_SIZE = 10` slice was
 *     accidentally load-bearing: it kept SearXNG's top-10 and let BM25 reorder inside a
 *     pre-filtered set. Removing the slice while keeping BM25 hands BM25 more junk to
 *     promote. The slice and the rerank had to come out together, never the slice alone.
 *  2. `searxng-score-sort` is NOT "SearXNG's ranking". `get_ordered_results()`
 *     (results.py:191-244) sorts by `score` and THEN regroups by category/template
 *     (`gresults.insert`, :224-243). Re-sorting by the raw `score` field undoes that second
 *     pass and costs 0.100 recall. The JSON arrives already ordered; touching it is the bug.
 *
 * RRF survives here because phase 2 needs it for a DIFFERENT job: fusing the candidate lists
 * of several sub-queries, where there is no pre-existing merged order to respect.
 */

/** RRF constant. 60 is the value from the original Cormack et al. paper and the one the
 * vault RAG already uses (`query.py:260`) — kept identical so the two stacks stay comparable. */
export const RRF_K = 60;

/**
 * Reciprocal Rank Fusion over N rankings of the same items.
 *
 * `score(d) = Σ_i w_i / (RRF_K + rank_i(d))`, 1-based ranks. Rank-based rather than
 * score-based on purpose: the inputs are not commensurable (one sub-query's SearXNG score is
 * an unbounded consensus sum computed against a different candidate pool than the next
 * sub-query's), and normalizing unbounded scores onto one scale is exactly where hand-tuned
 * fusion goes wrong. Ranks are comparable by construction.
 *
 * A key missing from a ranking contributes nothing from that arm — RRF has no missing-value
 * problem, which is what makes it the right tool for "this URL came back for 4 of 6
 * sub-queries": appearing in more lists is itself the signal.
 *
 * @param {string[][]} rankings  each an ordered list of keys, best first
 * @param {number[]}   weights   one per ranking; defaults to 1.0 each
 * @param {number}     k         RRF constant
 * @returns {Map<string, number>} key -> fused score (higher is better)
 */
export function reciprocalRankFusion(rankings, weights = [], k = RRF_K) {
  const scores = new Map();
  rankings.forEach((ranking, i) => {
    const w = weights[i] ?? 1.0;
    ranking.forEach((key, idx) => {
      scores.set(key, (scores.get(key) ?? 0) + w / (k + idx + 1));
    });
  });
  return scores;
}

/** Cosine similarity of two equal-length numeric vectors. Assumes nothing about
 * normalization (unlike the vault RAG's stored L2-normalized vectors, Ollama's `/api/embed`
 * output is not guaranteed normalized), so it divides by both magnitudes. Returns 0 for a
 * zero vector rather than NaN. */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Cap how many candidates any single host may contribute, preserving order.
 *
 * One SEO farm or doc mirror can otherwise own the entire fetch budget. This ORDERS, it does
 * not REJECT: the overflow is moved to the tail rather than dropped, so a host that genuinely
 * holds every good answer still gets read once the diverse candidates are exhausted. That
 * distinction is the whole design rule of this pipeline — only the curator rejects.
 *
 * @param {object[]} candidates  best first
 * @param {Function} hostFn      candidate -> host string
 * @param {number}   perHost     max per host in the head
 */
export function capPerHost(candidates, hostFn, perHost = 3) {
  if (perHost <= 0) return candidates;
  const seen = new Map();
  const head = [];
  const tail = [];
  for (const c of candidates) {
    const h = hostFn(c) || "";
    const n = seen.get(h) ?? 0;
    if (n < perHost) {
      seen.set(h, n + 1);
      head.push(c);
    } else {
      tail.push(c);
    }
  }
  return [...head, ...tail];
}

/**
 * Maximal Marginal Relevance: re-order already-curated results to balance relevance against
 * diversity, so 5 near-duplicate pages of the same answer don't crowd out a 6th that covers a
 * different angle. OFF by default (ADR-0028's own precedent for this exact family of technique —
 * "helps topically-redundant pools, can hurt a genuinely single-relevant-answer one", shipped
 * opt-in there and given the same treatment here rather than assumed to help).
 *
 * Iterative: repeatedly picks the remaining candidate maximizing
 * `lambda * relevance - (1 - lambda) * max(cosine to any already-picked item)`, so a highly
 * relevant item is still picked first, but a near-duplicate of something already picked is
 * discounted by how similar it is — never rejected outright, only demoted, matching this
 * pipeline's "only the curator rejects" rule (a low-relevance item MMR demotes to the tail was
 * already going to lose to `dropBelow`; MMR does not add a second, uninspectable rejection path).
 *
 * @param {object[]} candidates            best-first, already curated (never raw SERP order)
 * @param {Function} getVector             candidate -> embedding vector (number[]), or null/undefined
 *                                         if unavailable — an item with no vector is treated as
 *                                         maximally distinct from everything (never penalized for
 *                                         similarity it cannot be measured against)
 * @param {Function} getRelevance          candidate -> number, the existing curator score driving
 *                                         the "relevance" half of the trade-off
 * @param {number}   [lambda=0.5]          1.0 = pure relevance (no-op vs. input order), 0.0 = pure
 *                                         diversity
 * @returns {object[]} the same candidates, reordered
 */
export function mmr(candidates, getVector, getRelevance, lambda = 0.5) {
  if (lambda >= 1 || candidates.length <= 1) return candidates;
  // Fixed-size arrays indexed by ORIGINAL position throughout — a `taken` flag marks what's
  // already picked instead of splicing `candidates`/`vectors`, so an index never needs remapping.
  const vectors = candidates.map((c) => getVector(c) || null);
  const taken = new Array(candidates.length).fill(false);
  const picked = [];

  for (let round = 0; round < candidates.length; round++) {
    let bestI = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (taken[i]) continue;
      const rel = Number(getRelevance(candidates[i])) || 0;
      let maxSim = 0;
      if (vectors[i]) {
        for (let j = 0; j < candidates.length; j++) {
          if (!taken[j] || !vectors[j]) continue;
          const sim = cosine(vectors[i], vectors[j]);
          if (sim > maxSim) maxSim = sim;
        }
      }
      const score = lambda * rel - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestI = i;
      }
    }
    taken[bestI] = true;
    picked.push(candidates[bestI]);
  }
  return picked;
}
