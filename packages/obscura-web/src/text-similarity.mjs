/**
 * Ratcliff/Obershelp string similarity — the exact algorithm behind Python's
 * `difflib.SequenceMatcher.ratio()`, verified (not assumed from a README) against Scrapling's
 * actual source (github.com/D4Vinci/Scrapling, `scrapling/parser.py:1048-1152`,
 * `__calculate_similarity_score`/`__are_alike`/`find_similar`). Scrapling's "adaptive scraping"
 * — relocating an element after a page redesign — scores a candidate against a stored baseline
 * on SEVERAL facets (tag name, text, individual attributes, tree path, parent tag/attributes,
 * sibling list), each via this same ratio, then averages them against a threshold.
 *
 * obscura-web has no DOM tree to fingerprint that way: SERP records are already flattened to
 * `{title, url, snippet}` by regex, and page content is markdown text, not a parse tree. Porting
 * the full multi-facet element-relocation system would mean giving this package a real DOM
 * parser and a persisted per-selector baseline — a disproportionate lift for a fallback-of-
 * last-resort scrape path that SearXNG's structured JSON already deprioritizes (ADR-0051 §4).
 * What DOES port cleanly is the primitive itself, applied to the one signal this package
 * actually has: text. Used by `serp.mjs`'s generic markup-drift fallback to rank candidates by
 * how closely they resemble the query, the same job similarity scoring does for Scrapling, just
 * over text instead of DOM structure.
 */

/**
 * `ratio = 2*M / (len(a)+len(b))`, where M is the total length of matching characters found by
 * Ratcliff/Obershelp's algorithm: take the single longest common CONTIGUOUS substring, then
 * recurse on what remains to its left and to its right in both strings, summing every match
 * found. This is longest-common-SUBSTRING recursion, not longest-common-SUBSEQUENCE — it only
 * ever credits contiguous runs, which is exactly why two phrases with the same words in a
 * different order score lower than a naive token-overlap count would (`difflib` documents the
 * same property). 1.0 for identical strings, 0 when nothing matches at all.
 *
 * Empty-string edge cases are this module's own defined semantics (Python's difflib does not
 * clearly document `SequenceMatcher(None, "", "").ratio()` as a stable contract): both empty is
 * defined as 1 (nothing differs), exactly one empty is defined as 0 (maximally different).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0..1
 */
export function similarityRatio(a, b) {
  const s1 = String(a ?? "");
  const s2 = String(b ?? "");
  if (!s1.length && !s2.length) return 1;
  if (!s1.length || !s2.length) return 0;
  return (2 * matchingChars(s1, s2)) / (s1.length + s2.length);
}

/** Longest common contiguous substring within `a[aLo,aHi)` / `b[bLo,bHi)`. Returns
 * `[aStart, bStart, length]`, `length` 0 if there is no overlap at all. A per-call index of
 * `b`'s characters keeps this O(n·m) rather than O(n·m·min(n,m)) — fine for the short strings
 * (query terms, SERP titles/snippets) this is used on; not intended for full-document diffing. */
function longestMatch(a, aLo, aHi, b, bLo, bHi) {
  let bestI = aLo;
  let bestJ = bLo;
  let bestLen = 0;

  const bIndex = new Map();
  for (let j = bLo; j < bHi; j++) {
    const ch = b[j];
    if (!bIndex.has(ch)) bIndex.set(ch, []);
    bIndex.get(ch).push(j);
  }

  let j2len = new Map(); // j2len.get(j) = length of the match ending at b-index j, for the a-index just processed
  for (let i = aLo; i < aHi; i++) {
    const newJ2len = new Map();
    const positions = bIndex.get(a[i]);
    if (positions) {
      for (const j of positions) {
        const k = (j2len.get(j - 1) || 0) + 1;
        newJ2len.set(j, k);
        if (k > bestLen) {
          bestI = i - k + 1;
          bestJ = j - k + 1;
          bestLen = k;
        }
      }
    }
    j2len = newJ2len;
  }
  return [bestI, bestJ, bestLen];
}

/** Sum of every matching block's length, found by repeatedly taking the longest match and
 * recursing on its left/right remainders. An explicit stack (not real recursion) so a long
 * string with many small matches can't blow the call stack. */
function matchingChars(a, b) {
  let total = 0;
  const stack = [[0, a.length, 0, b.length]];
  while (stack.length) {
    const [aLo, aHi, bLo, bHi] = stack.pop();
    if (aLo >= aHi || bLo >= bHi) continue;
    const [i, j, k] = longestMatch(a, aLo, aHi, b, bLo, bHi);
    if (!k) continue;
    total += k;
    stack.push([aLo, i, bLo, j]); // left of the match
    stack.push([i + k, aHi, j + k, bHi]); // right of the match
  }
  return total;
}
