/**
 * Curator-QUALITY benchmark: does a model's `curatePage` verdict match a labelled
 * (query, page) -> relevant|irrelevant golden set? This is the scorer `bench-research.mjs`'s own
 * header explicitly deferred ("curation quality is a separate question with a separate scorer,
 * because it needs a live Ollama and is therefore not a deterministic CI gate") — this is that
 * scorer, built to run the curator bake-off ADR-0057 left as a measured, not assumed, decision.
 *
 * What it scores: given FROZEN page text (bench-curate-capture.mjs) and a REAL model call (no
 * mocking — the whole question is how a specific model behaves), does `relevance >= dropBelow`
 * agree with the label? Accuracy alone hides WHICH kind of mistake a model makes, so this also
 * reports false-positive rate on the labelled `irrelevant` bucket specifically — that bucket
 * contains the confirmed live failure (MDN WritableStream pages scored relevance:9 for a SQLite
 * query) this bench exists to catch, and a model that is merely "accurate on average" while still
 * failing that exact case would be a worse pick than the numbers alone would suggest.
 */

/**
 * @param {object}   opts
 * @param {object[]} opts.entries      loaded curation.jsonl entries: {query, url, label, note?}
 * @param {Map<string,string>} opts.fixtures  url -> frozen page text
 * @param {Function} opts.curate      async ({markdown, query}) -> {relevance, reason, excerpt}
 * @param {number}   [opts.dropBelow=3]  reference threshold applied uniformly across models being
 *                                       compared — NOT each model's own possibly-different default,
 *                                       since the bake-off must hold the threshold fixed to isolate
 *                                       the model as the only variable.
 * @returns {Promise<object>} aggregate + per-entry detail
 */
export async function evaluateCuration({ entries, fixtures, curate, dropBelow = 3 }) {
  const results = [];
  for (const e of entries) {
    const markdown = fixtures.get(e.url);
    if (markdown === undefined) {
      throw new Error(`bench-curate: no fixture for ${e.url} — run bench-curate-capture.mjs`);
    }
    const wantRelevant = e.label === "relevant";
    const t0 = Date.now();
    let relevance = null;
    let reason = "";
    let errored = false;
    try {
      const curated = await curate({ markdown, query: e.query });
      relevance = curated.relevance;
      reason = curated.reason ?? "";
    } catch (err) {
      errored = true;
      reason = `ERROR: ${err.message}`;
    }
    const ms = Date.now() - t0;
    const gotRelevant = typeof relevance === "number" ? relevance >= dropBelow : null;
    results.push({
      query: e.query,
      url: e.url,
      label: e.label,
      note: e.note ?? "",
      wantRelevant,
      relevance,
      gotRelevant,
      correct: !errored && gotRelevant === wantRelevant,
      errored,
      reason,
      ms
    });
  }

  const n = results.length;
  const correct = results.filter((r) => r.correct).length;
  const errors = results.filter((r) => r.errored).length;

  // False positives: labelled irrelevant, but the model called it relevant — the exact failure
  // mode this bench was built to catch (keyword-overlap fooling the curator), reported on its own
  // because it is the more expensive mistake (a wrong page reaches the agent) than a false
  // negative (a right page gets dropped, but `include_rejected` can still recover it).
  const irrelevantEntries = results.filter((r) => !r.wantRelevant);
  const falsePositives = irrelevantEntries.filter((r) => r.gotRelevant === true);
  const relevantEntries = results.filter((r) => r.wantRelevant);
  const falseNegatives = relevantEntries.filter((r) => r.gotRelevant === false);

  const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const meanRelevantScore = mean(
    relevantEntries.filter((r) => typeof r.relevance === "number").map((r) => r.relevance)
  );
  const meanIrrelevantScore = mean(
    irrelevantEntries.filter((r) => typeof r.relevance === "number").map((r) => r.relevance)
  );

  return {
    n,
    accuracy: n ? correct / n : 0,
    errors,
    falsePositiveCount: falsePositives.length,
    falsePositiveRate: irrelevantEntries.length
      ? falsePositives.length / irrelevantEntries.length
      : 0,
    falseNegativeCount: falseNegatives.length,
    // Band separation: how far apart the model scores the two buckets on average. A model that is
    // "accurate" right at the threshold but barely separates the bands is more fragile to a
    // slightly different dropBelow than one with a wide, confident gap.
    meanRelevantScore,
    meanIrrelevantScore,
    separation: meanRelevantScore - meanIrrelevantScore,
    meanMs: mean(results.map((r) => r.ms)),
    results
  };
}

/** Human-readable one-screen summary, same shape convention as `bench-research.mjs#formatReport`. */
export function formatCurationReport(report, label = "") {
  const lines = [
    `curation bench${label ? ` [${label}]` : ""}: n=${report.n} accuracy=${report.accuracy.toFixed(3)} errors=${report.errors}`,
    `  false positives (irrelevant scored relevant): ${report.falsePositiveCount} ` +
      `(rate=${report.falsePositiveRate.toFixed(3)}) <- the expensive mistake`,
    `  false negatives (relevant scored irrelevant): ${report.falseNegativeCount}`,
    `  mean relevance: relevant=${report.meanRelevantScore.toFixed(2)} ` +
      `irrelevant=${report.meanIrrelevantScore.toFixed(2)} separation=${report.separation.toFixed(2)}`,
    `  mean latency: ${report.meanMs.toFixed(0)}ms/page`
  ];
  const misses = report.results.filter((r) => !r.correct);
  if (misses.length) {
    lines.push(`  misses (${misses.length}):`);
    for (const r of misses) {
      lines.push(
        `    [${r.label}->got:${r.gotRelevant}] relevance=${r.relevance} ${JSON.stringify(r.url)} ` +
          `(query: ${JSON.stringify(r.query)})${r.reason ? ` — ${r.reason.slice(0, 100)}` : ""}`
      );
    }
  }
  return lines.join("\n");
}
