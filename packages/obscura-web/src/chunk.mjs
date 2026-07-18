/**
 * Sliding-window chunking over already-cleaned page text (post `stripHiddenContent`).
 *
 * Why this exists: `deepResearch` truncates a page to `maxInputChars` (12,000 by default,
 * `ollama-client.mjs#DEFAULT_MAX_INPUT_CHARS`) before curation ever sees it — reported honestly
 * via `truncated: true`, but the tail of a long page is simply never read, regardless of whether
 * the actual answer lives there. Chunking turns "the first N chars" into "candidate passages",
 * so an embedding pass (`ollama-client.mjs#embedPassages`) can pick the passages closest to the
 * QUERY rather than the ones that happen to load first — never a replacement for the curator's
 * judgment (chunk selection narrows what the curator reads, it never decides relevance itself,
 * matching this pipeline's one hard rule: only the curator rejects a page).
 *
 * Pure module, no I/O — `selectChunksByRelevance` takes already-computed vectors rather than
 * calling `embedPassages` itself, so the actual network call (and its deadline-accounting) stays
 * the caller's responsibility, same boundary `rank.mjs` keeps for the same reason.
 */
import { cosine } from "./rank.mjs";

/** Split cleaned text into paragraphs the way `extractPassage` already does, so a chunk boundary
 * never lands mid-paragraph — `stripHiddenContent` guarantees a blank-line separator after each
 * block element, so this split is meaningful, not a guess at prose structure. */
function splitParagraphs(text) {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Group paragraphs into overlapping chunks of roughly `chunkChars`, so a passage that spans a
 * paragraph boundary is never split away from its own continuation. Overlap (`overlapChars`)
 * repeats the tail of one chunk at the head of the next, so a sentence that straddles a chunk
 * boundary is never the ONLY copy that got cut off mid-thought — the standard RAG chunking trade
 * (a little redundancy, in exchange for never silently losing a boundary-straddling passage).
 *
 * @param {string} text        already-cleaned page text (paragraphs separated by blank lines)
 * @param {{ chunkChars?: number, overlapChars?: number, minChunkChars?: number }} [opts]
 * @returns {string[]} chunks, in original document order — empty input yields an empty array
 */
export function chunkText(text, opts = {}) {
  const chunkChars = Math.min(Math.max(Number(opts.chunkChars) || 1500, 200), 8000);
  const overlapChars = Math.min(Math.max(Number(opts.overlapChars) || 200, 0), chunkChars / 2);
  const minChunkChars = Math.min(Math.max(Number(opts.minChunkChars) || 100, 1), chunkChars);

  const paras = splitParagraphs(text);
  if (!paras.length) return [];

  const chunks = [];
  let current = "";
  let overlapTail = "";
  for (const p of paras) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (current && candidate.length > chunkChars) {
      chunks.push(current);
      // Seed the next chunk with the tail of this one (not the whole thing — a full-paragraph
      // overlap on a large paragraph would make forward progress glacial on a very long page).
      overlapTail = current.slice(-overlapChars);
      current = overlapTail ? `${overlapTail}\n\n${p}` : p;
    } else {
      current = candidate;
    }
  }
  if (current && current !== overlapTail) chunks.push(current);

  // A single paragraph longer than chunkChars produces its own oversized chunk above (never
  // silently truncated) — that is correct, just rare on real prose; only drop chunks that are
  // near-empty scraps (e.g. a lone heading with no body), which add cost with nothing to embed.
  return chunks.filter((c) => c.length >= minChunkChars || chunks.length === 1);
}

/**
 * Pick the chunks most relevant to the query, up to a character budget, returned in ORIGINAL
 * document order (not similarity order) — the curator reads better, coherent prose that way, and
 * order is not evidence of relevance to begin with. Greedy by cosine similarity to the query
 * vector: keeps taking the next-best-scoring chunk until the budget would be exceeded, then stops
 * (a partially-fitting next chunk is left out whole, never truncated mid-chunk).
 *
 * @param {string[]} chunks        from {@link chunkText}, original document order
 * @param {number[][]} chunkVectors  one embedding per chunk, same order and length as `chunks`
 * @param {number[]} queryVector   the query's own embedding
 * @param {number} maxChars        character budget for the concatenated result
 * @returns {string[]} the selected chunks, in ORIGINAL order, joined by the caller
 */
export function selectChunksByRelevance(chunks, chunkVectors, queryVector, maxChars) {
  if (!chunks.length) return [];
  const scored = chunks.map((c, i) => ({
    i,
    c,
    score: cosine(chunkVectors[i], queryVector)
  }));
  const byScore = [...scored].sort((a, b) => b.score - a.score);

  const takenIdx = new Set();
  let budget = 0;
  for (const s of byScore) {
    const cost = s.c.length + (takenIdx.size ? 2 : 0); // +2 for the "\n\n" join, once selected
    if (budget + cost > maxChars) {
      if (takenIdx.size) continue; // a later, smaller chunk might still fit
      // Nothing selected yet and even the single best chunk doesn't fit: take it anyway,
      // truncated, rather than returning nothing — same "never silent, never empty" contract
      // extractPassage already keeps.
      takenIdx.add(s.i);
      break;
    }
    takenIdx.add(s.i);
    budget += cost;
  }
  return scored.filter((s) => takenIdx.has(s.i)).map((s) => s.c);
}
