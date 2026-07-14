# ADR-0055: `obscura_research` curates pages with a local Ollama model, not keyword overlap

- **Status:** Accepted
- **Date:** 2026-07-12
- **Deciders:** maintainer

## Context

ADR-0054 shipped `obscura_research`'s candidate ranking (BM25) and passage extraction
(`extractPassage`) as pure keyword-overlap heuristics. The user identified a real flaw in that
design, directly: research is not just "find what matches the query's wording" — the point of
researching is often _new_ information, and new information frequently does **not** share the
query's vocabulary. A pure lexical filter systematically discards exactly the content a research
task is supposed to surface: a tangential finding phrased differently, a related fact under
different terminology, the elaboration in the paragraph _after_ the one that happens to repeat
the search term.

The user's proposed fix was specific: use a **local LLM** to actually understand and relate each
page to the query — "que la tiene que entender y relacionar" — while keeping the same constraint
this whole feature exists under (ADR-0054): the cost must land on local CPU/RAM, not on Claude's
token budget. The user was equally specific about the shape: process **one page at a time**, never
hold more than one page's raw content at once, and return only the already-**curated** info —
i.e. no accumulated context across pages, and the raw page text never reaches the calling agent.

Reality check before building on it: `packages/vkm-spec/src/ollama-client.mjs` already implements
exactly this kind of integration for a different purpose (drafting a spec's fields) — a minimal
`fetch`-based client, a single typed `OllamaUnavailableError` every failure mode collapses into,
structured JSON output via Ollama's `format` param, and a hard invariant that the feature keeps
working with Ollama absent. Read in full before writing anything new (verify-before-design, per
`vkm-discipline`'s coding domain), not assumed from the test names.

## Decision

Add `packages/obscura-web/src/ollama-client.mjs` — a **self-contained** adaptation of that proven
pattern (same convention `untrusted-web.mjs` already documents: obscura-web stays independently
runnable, no cross-workspace dependency on `vkm-spec`), exposing `checkOllama`,
`OllamaUnavailableError`, `ensureOllamaServer`, and a new `curatePage(markdown, query)`. Same
default model (`phi4-mini:3.8b-q4_K_M`) and same default host (`127.0.0.1:11434`) as vkm-spec on
purpose: a user who already has Ollama running for spec-drafting gets research curation for free
from the same daemon, no second model to pull.

1. **One availability check per `deepResearch` call, not per page.** `checkOllama` + best-effort
   `ensureOllamaServer` run once before the fetch loop; Ollama's up/down state doesn't change
   mid-crawl. `OBSCURA_RESEARCH_OLLAMA=0` opts out even when a daemon happens to be reachable.
2. **`curatePage` replaces `extractPassage` as the primary path, per page, only when Ollama is
   available.** It sends ONE page's text (capped at `maxInputChars`, default 12,000 chars, for
   bounded CPU latency — truncation is reported via `truncated: true`, never silent) plus the
   query to `/api/chat` with a JSON-Schema `format` (`{relevant: boolean, excerpt: string}`,
   validated with zod exactly like `vkm-spec`'s `SpecSchema`/`SPEC_JSON_SCHEMA` pair), asking the
   model to recognize topically-related content even when it doesn't share the query's wording,
   and to quote the kept passage verbatim (no paraphrasing, no invented content).
3. **Strictly sequential, never accumulated.** `deepResearch`'s fetch loop already processed pages
   one at a time (ADR-0054); `content` for a given page is a loop-local variable that goes out of
   scope the moment that iteration's curation call returns — no page's text is ever combined with
   another's in one model call, and no page's full text is ever included in what's returned to the
   agent, only the curated excerpt.
4. **Every failure degrades to the ADR-0054 heuristic, per page, not per call.** A `curatePage`
   throw (any `OllamaUnavailableError` reason, or Ollama simply not being installed) falls back to
   `extractPassage` for _that one page_ — one flaky page doesn't sink the whole research call, and
   the tool's overall contract ("works with obscura absent, works with SearXNG absent, works with
   Ollama absent") stays intact. Each result reports `extraction: "ollama" | "heuristic"` and
   `relevant: boolean` so the agent can see which path a given passage actually took.
5. **Scope stays bounded to `top_k`.** Curation is not applied to the `max_candidates` gather stage
   (up to 300) — running a local model 300 times per research call is not a viable latency budget
   on CPU-only hardware; BM25 remains the coarse filter that decides which `top_k` pages are even
   fetched. This mirrors ADR-0054's own explicit boundary (BM25 for ranking candidates, heuristic
   for excerpting fetched pages) — this ADR only replaces the excerpting half.
6. **`relevant: false` still returns a result, not silence.** If the model judges a fetched page
   irrelevant, the tool still reports it (with a heuristic-extracted excerpt as a courtesy, since
   the fetch already happened) rather than dropping it — the agent, not the local model, makes the
   final call on what to use.

## Alternatives considered

- **Summarize with the local model instead of extracting verbatim:** rejected for now — a
  generative summary can drift from the source text; a curator that must quote verbatim can't
  hallucinate content that wasn't on the page, which matters more here than prose polish.
- **Run curation on the full `max_candidates` pool instead of just `top_k`:** rejected — see
  decision §5; not a realistic latency budget on local CPU hardware, and BM25 is a reasonable
  coarse pre-filter for "is this candidate even worth fetching."
- **Batch multiple pages into one Ollama call to save round-trips:** rejected — directly
  contradicts the user's explicit requirement (page-by-page, nothing accumulated); a small local
  model's context window is also a real constraint multi-page batching would strain first.
- **Cross-workspace dependency on `@vkmikc/vkm-spec` instead of a self-contained copy:** rejected
  — breaks the established "obscura-web stays independently runnable" convention
  (`untrusted-web.mjs`); the duplicated surface here is small (one file, generic Ollama-protocol
  helpers) and the two packages' needs already diverge (streaming structured-spec JSON vs.
  single-shot page curation).

## Consequences

- Positive: the vocabulary-mismatch flaw in ADR-0054's pure BM25/keyword design is fixed at the
  excerpt stage — a page can be kept for information that doesn't restate the query. Zero Claude
  tokens spent on the crawl OR the curation (both are local CPU/RAM work); zero new npm
  dependencies (reuses `zod`, already a dependency); shares one Ollama daemon with `vkm-spec` when
  both are installed.
- Negative: real curation quality still requires the user to have Ollama + the model pulled —
  without it, `obscura_research` is exactly ADR-0054's heuristic-only behavior, no worse but no
  better. Sequential per-page local-model calls add real latency on top of the fetch itself
  (bounded by `top_k`, same latency-dial tradeoff ADR-0054 already documents for fetching). A
  3.8B-parameter local model's judgment is not as reliable as Claude's — `curatePage`'s verbatim
  constraint and the `relevant`/`extraction` fields exist specifically so the agent can see and
  discount a shaky verdict rather than trust it blindly.
- Neutral: `OBSCURA_OLLAMA_HOST`/`OBSCURA_OLLAMA_MODEL`/`OBSCURA_OLLAMA_KEEP_ALIVE`/
  `OBSCURA_RESEARCH_OLLAMA` are new, all optional with working defaults; `obscura_search`/
  `obscura_fetch` and `obscura_research`'s own candidate-ranking stage are unchanged.

## References

- `packages/obscura-web/src/ollama-client.mjs` (`checkOllama`, `curatePage`, `OllamaUnavailableError`,
  `ensureOllamaServer`), `src/research.mjs` (`deepResearch`'s per-page curate-then-fallback loop),
  `test/ollama-client.test.mjs`, `test/research.test.mjs`.
- ADR-0054 (obscura_research base: BM25 ranking + heuristic excerpting — this ADR replaces the
  excerpting half only, per page, when Ollama is available).
- `packages/vkm-spec/src/ollama-client.mjs` + ADR-0046/ADR-0047 (the proven pattern this reuses:
  typed unavailable-error, structured `format` output, deterministic-fallback hard invariant).
