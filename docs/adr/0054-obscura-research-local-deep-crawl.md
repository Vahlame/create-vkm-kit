# ADR-0054: `obscura_research` — deep web research as local CPU/RAM work, not tokens

- **Status:** Accepted
- **Date:** 2026-07-12
- **Deciders:** maintainer

## Context

`obscura_search` (ADR-0051/ADR-0052) caps `limit` at 20 and defaults to a single engine page — by
design, matching the honest constraint already documented in `serp.mjs`: free SERP scraping cannot be
fast + high-volume + relevant at once. That ceiling is real friction for a task that genuinely needs to
scan broadly (research spanning many sources) before narrowing down: the agent either accepts a shallow
~10–20 result pool, or has to call `obscura_search`/`obscura_fetch` many times in a loop.

The first design floated for "search deeper" was subagent dispatch (an Explore/Haiku subagent scans and
returns a distilled summary). The user rejected that framing explicitly: a subagent still spends real
LLM tokens and account quota — it only _relocates_ the cost out of the main conversation, it doesn't
_remove_ it. The actual ask was sharper: push the crawl as far as possible into a process that costs
**CPU/RAM, not tokens** — and obscura-web already has exactly that available and idle. `obscura` (the
headless browser) and SearXNG both already run as local, per-request/on-demand OS processes (ADR-0051
§"No open port", ADR-0052) that cost zero LLM tokens to execute; the gap was that the "search and search
and search" loop lived in the agent calling the MCP tool N times (each round-trip paid for in tokens),
not inside the already-local Node process.

Constraint carried over from `serp.mjs`/ADR-0052: deep, _reliable_ pagination needs a local SearXNG
instance (`pageno`, structured JSON, no anti-bot wall — verified live against
`docs.searxng.org/dev/search_api.html`, `pageno` default `1`). Paginating DuckDuckGo/Bing/Brave HTML
past page 1 by guessing each engine's offset parameter is exactly the fragile, rate-limited path
`serp.mjs`'s own top-of-file comment already rules out for volume.

## Decision

Add a third tool, `obscura_research(query, max_candidates, top_k, passage_chars, stealth)`
(`src/research.mjs`), that keeps the entire "search deep" loop local and hands the agent only a bounded,
relevant slice:

1. **Gather locally.** Walk SearXNG's `pageno` server-side (`searxngSearch` extended with a `page` param)
   up to `max_candidates` (default 50, hard cap 300 — past that, narrow the query instead of widening the
   crawl). One loopback HTTP round-trip per page, zero LLM tokens.
2. **Rank locally.** Score every gathered candidate's title+snippet against the query with BM25
   (`rankCandidates`, k1=1.5, b=0.75, +1-smoothed IDF so a tiny candidate pool never produces a negative
   score) — the candidate pool is its own corpus, so no external index, embedding model, or LLM call is
   needed.
3. **Fetch narrowly.** Only the top `top_k` (default 8, cap 30) ranked candidates are actually fetched via
   the existing `obscuraFetch`.
4. **Excerpt, don't dump.** Each fetched page is cut down to the paragraph(s) that match the query
   (`extractPassage`, bounded by `passage_chars`, default 800) instead of returning the whole page — the
   token cost per _read_ page stays flat regardless of how many candidates were _scanned_.
5. **No SearXNG → degrade honestly.** If SearXNG is unreachable (or `OBSCURA_SEARXNG_URL=""`), skip the
   pageno loop entirely and fall through to `searchWeb`'s existing single-page scrape chain — the same
   ceiling `obscura_search` already has, not a hand-rolled fragile pagination attempt against DDG/Bing/Brave.
6. **Report the gap, not just the result.** The response carries `scanned` (candidates gathered) and
   `fetched` (pages actually read) alongside `results`, so the agent can see how deep the search actually
   went without paying tokens for the difference.

Every step through ranking is deterministic and dependency-free (no new npm package); only the final
`top_k` fetches touch the network for full page content, and only their extracted passages — not the raw
markdown, not the full candidate pool — cross into the agent's context.

## Alternatives considered

- **Subagent/Haiku dispatch for deep search:** rejected by the user directly — still spends real tokens
  and account quota, just outside the main conversation; doesn't address "no queremos que nos cuelen
  millones de tokens", it only hides where they're spent.
- **Just raise `obscura_search`'s `limit` cap and expose `page` directly to the agent:** considered first;
  rejected because the agent would still pay a full tool round-trip (and a full JSON result set) per page
  it walks — the loop needs to live inside the already-local MCP process to actually be free, not just be
  reachable by the agent.
- **Per-engine offset scraping for DuckDuckGo/Bing/Brave (page 2+):** rejected — `serp.mjs` already
  documents why free SERP scraping can't be fast + high-volume + relevant at once (DDG rate-limits
  bursts); building fragile offset-pagination against markup that already needs "resilient extractor"
  maintenance is a worse trade than degrading cleanly to page 1.
- **Summarize each fetched page through a cheap LLM call instead of local passage extraction:** rejected
  for v1 — real per-page token savings, but reintroduces the exact cost this ADR exists to avoid (an LLM
  call in the loop) and adds latency; local paragraph-relevance extraction is zero-token and, being
  extractive rather than generative, cannot hallucinate content that wasn't on the page.
- **Fetch the `top_k` pages in parallel:** deferred — `obscura` spawns a real headless-browser process
  per fetch (ADR-0051's per-request model), so unbounded concurrency is a real resource cost; sequential
  fetch matches the codebase's existing style (`searchWeb`'s engine-chain loop) and keeps a first
  implementation easy to reason about and test deterministically. Worth revisiting if `top_k` latency
  becomes the practical bottleneck.

## Consequences

- Positive: a task that needs to scan hundreds of candidates costs the agent tokens for `top_k` compact
  passages, not for the pool it was chosen from — the actual mechanism the user asked for (local CPU/RAM
  absorbs the crawl, not the token budget). No new runtime dependency. Degrades honestly (never silently
  reports a shallow crawl as deep) when SearXNG isn't running.
- Negative: real depth still requires the user's local SearXNG setup (`packages/obscura-web/searxng/`,
  ADR-0052) — without it, `obscura_research` is no deeper than `obscura_search`. Sequential `top_k`
  fetches mean latency scales with `top_k` (a full 8-page pass is network-bound, on the order of a
  minute in the worst case) — `top_k` is the latency dial, not a hidden cost. The local BM25 ranker only
  sees title+snippet text, not full page content, so ranking quality is bounded by how informative SERP
  snippets are for a given query.
- Neutral: `max_candidates`/`top_k`/`passage_chars` are new, tunable per call; nothing about
  `obscura_fetch`/`obscura_search`'s existing behavior or defaults changed (`searxngSearch`'s new `page`
  param defaults to `1`, identical URL shape to before for every existing caller).

## References

- `packages/obscura-web/src/research.mjs` (`tokenize`, `rankCandidates`, `extractPassage`,
  `deepResearch`), `src/serp.mjs` (`searxngSearch` `page`/`pageno`), `src/obscura-mcp.mjs`
  (`obscura_research` tool registration), `test/research.test.mjs`.
- ADR-0051 (obscura-web base integration — per-request fetch model, no open port), ADR-0052 (SearXNG
  on-demand lifecycle — what `obscura_research` reuses to bring SearXNG up before crawling).
- SearXNG Search API docs: <https://docs.searxng.org/dev/search_api.html> (`pageno` parameter, verified
  live against the current instance during design).
