# `@vkmikc/obscura-web`

Stealth web access for your AI agent — an **opt-in** MCP server that fetches and searches the web
through the local [obscura](https://github.com/h4ckf0r0day/obscura) headless browser, preferred over
the native `WebFetch`/`WebSearch` (soft enforcement — the native tools stay as the fallback).

Part of [vkm-kit](../../README.md). Runs from the clone (a private workspace package), wired for Claude
Code, Codex and Cursor by the installer under `--obscura` / `--full`. See
[ADR-0051](../../docs/adr/0051-obscura-web-stealth-browser.md),
[ADR-0052](../../docs/adr/0052-searxng-on-demand-lifecycle.md),
[ADR-0054](../../docs/adr/0054-obscura-research-local-deep-crawl.md),
[ADR-0055](../../docs/adr/0055-obscura-research-local-llm-curation.md),
[ADR-0056](../../docs/adr/0056-research-knowledge-bank.md),
[ADR-0057](../../docs/adr/0057-obscura-research-gather-over-rank.md) (supersedes ADR-0055 §5/§6),
[ADR-0060](../../docs/adr/0060-obscura-deep-research-background-job.md) (background jobs, current
design), and [ADR-0062](../../docs/adr/0062-obscura-seed-url-crawler.md) (seed-URL site crawler).

## Why

- **`WebFetch`/`WebSearch` run server-side** on the model provider's infra — there's no setting to
  point them at a local stealth browser. The viable pattern is a **local MCP server** exposing new
  tools plus a nudge to prefer them.
- **obscura** renders real JS with anti-detection / fingerprint randomization / tracker blocking, so a
  page that blocks a plain HTTP fetch comes back clean.
- Everything is returned as **untrusted web DATA** and injection-flagged — never as instructions.

## Tools

### `obscura_fetch(url, …)`

Retrieve and render a URL through obscura. Preferred over native `WebFetch`.

| Param          | Type                                      | Default    | Notes                                                                                                                                                   |
| -------------- | ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`          | string                                    | —          | Absolute http(s) URL                                                                                                                                    |
| `format`       | `markdown` \| `text` \| `html` \| `links` | `markdown` | Output form (markdown is clean for reading). Ignored when `css_selector` is set.                                                                        |
| `css_selector` | string                                    | —          | Extract only matching element(s)' text (every match returned, hidden elements excluded) — cheaper than the whole page when you only need one part of it |
| `stealth`      | boolean                                   | on         | Anti-detection (flip default with `OBSCURA_STEALTH=0`)                                                                                                  |
| `timeout_ms`   | int 1000–120000                           | 30000      | Navigation budget                                                                                                                                       |

Oversized pages are capped (`OBSCURA_FETCH_MAX_CHARS`, default 60000) so a huge document can't flood
the agent's context. A **transient failure** (navigation timeout, connection reset) gets up to
`OBSCURA_FETCH_RETRIES` extra attempts (default 2) with exponential backoff + jitter
(`OBSCURA_FETCH_RETRY_BASE_MS`, default 500ms) before giving up — a missing `obscura` binary or a
non-transient navigation error (bad DNS, refused connection past the first try) is never retried,
since a second attempt can't fix either. `obscura_fetch_many` inherits this for free (same primitive). `css_selector` always fetches the raw HTML internally (a selector needs the DOM;
`format`'s other options have already discarded it) and runs it through the same hidden-element
exclusion `obscura_research`'s crawl uses (see below) — verified live against a real page:
`css_selector: "title"` on `sqlite.org/wal.html` returns exactly `"Write-Ahead Logging"`.

### `obscura_fetch_many(urls, …)`

Fetch up to 10 URLs concurrently in one call — prefer this over N separate `obscura_fetch` calls when
the URLs are already known (e.g. from a prior `obscura_search`). Same `format`/`stealth`/`timeout_ms`
params as `obscura_fetch`, applied to the whole batch, plus `concurrency` (default 4, cap 6 — each URL
spawns a real browser process). One URL failing reports its own error inline without sinking the rest
of the batch. Not a substitute for `obscura_research`: no ranking, curation, or candidate discovery —
it only fetches URLs you already have.

### `obscura_search(query, …)`

Layered, non-fragile web search. Preferred over native `WebSearch`. Returns normalized
`{ title, url, snippet }` results with a `source` field.

| Param       | Type     | Default | Notes                                                                                       |
| ----------- | -------- | ------- | ------------------------------------------------------------------------------------------- |
| `query`     | string   | —       | Keywords beat full sentences                                                                |
| `limit`     | int 1–20 | 8       | Max results                                                                                 |
| `stealth`   | boolean  | on      | Anti-detection when rendering SERPs                                                         |
| `translate` | boolean  | on      | Translate a non-English query to English first (primary sources are in English) — see below |

**English translation (`translate`, default on).** A non-English query is translated to English via
the local model before searching, because specs/docs/source are written in English (the same finding
`obscura_research`'s query expansion is built on). It is gated by a cheap heuristic — a query that
looks English (pure ASCII with no non-English function words) skips the model call entirely — and is
an enhancement, never a dependency: if the local model is unavailable or the call fails, the original
query is searched, never an error. When a translation happens the response carries `translatedFrom`
(the original) so it is transparent. The LLM still presents results to the user in their own language;
only the SEARCH is lifted to English. Set `translate: false` to search verbatim. Uses
`OBSCURA_OLLAMA_EXPAND_MODEL` (the same model as research expansion — no new model to pull).

**The layers** (first that yields results wins):

1. **Local SearXNG (structured JSON)** — aggregates many engines, no anti-bot wall. This is the fast +
   relevant path; free SERP scraping can't be fast + high-volume + relevant at once. Started **on
   demand** (see below), `source: "searxng"`.
2. **obscura-rendered SERP — a rotating engine chain**
   (`duckduckgo` → `bing` → `brave` → `mojeek` → `marginalia` → `ecosia` → `bing-rss`,
   first-with-results wins; ADR-0051 amendment 2026-07-22). When one engine is banned/empty the next
   is tried, and the native fallback fires only after **all** fail — so a single DuckDuckGo rate-limit
   no longer drops straight to native. Order is relevance-then-resilience: DuckDuckGo has the best
   free-scrape relevance for technical queries; `bing`/`brave` HTML are next. Then
   `mojeek`/`marginalia`/`ecosia` are **generic-extraction engines** — no bespoke HTML parser, their
   SERP is scraped by the same similarity-ranked extractor used for parser drift, so each costs only a
   search-URL pattern, not a maintained per-engine parser (`mojeek`/`marginalia` are independent
   indexes for real diversity; `startpage` is env-only). `bing-rss` is last because it keyword-matches
   literally (measured: "tau" → the Greek letter, "pass" → Xbox Game Pass) BUT is structured XML that
   never rate-limits — the always-answers last resort. Google is avoided (aggressive anti-bot).
   Override the chain per-machine with `OBSCURA_SEARCH_ENGINES` (add/reorder/remove). Two more
   generic-extraction engines are registered but **not** in the default chain — `yahoo` and `qwant`,
   opt-in only (same posture as `startpage`): their generic-extraction viability through obscura's
   rendered DOM hasn't been verified live, only wired per the same pattern as the engines above. **For
   the widest, most relevant many-engine (incl. regional / non-English) search, SearXNG (Layer 1) is
   still the primary mechanism — ~100 upstream-maintained engines behind one structured API.** **If a
   specific engine's parser finds zero results on an otherwise-substantial page** (the engine changed
   its markup — the known risk this layer has always carried), a generic, engine-agnostic extractor
   tries to recover real results anyway, ranked by textual resemblance to the query rather than
   returned in document order (inspired by [Scrapling](https://github.com/D4Vinci/Scrapling)'s
   adaptive matching, adapted to this package's flat SERP records rather than a DOM tree — see
   ADR-0057's addendum). A drift break can also be caught **proactively**, before a real query hits
   it: `node src/canary-run.mjs` probes every registered engine with known-good queries and reports
   which ones came back empty — run it manually or on a schedule, never from `npm test` (it hits real
   engines over the network).
3. **Native `WebSearch` fallback** — if every source fails or returns nothing AND there's no cached
   answer for this exact query, the tool returns a message that explicitly steers the agent back to
   the native tool. If there **is** a cached answer (even past its TTL), it's served instead —
   `stale: true` on the response — so a machine that's genuinely offline or fully rate-limited still
   gets its last-known results rather than a hard error (opt-in disk persistence for this and the two
   `obscura_research` caches below, see `OBSCURA_CACHE_DIR` in the env table).

### `obscura_research(query, …)`

Deep research without spending agent tokens on the crawl (ADR-0054, redesigned in ADR-0057).
Preferred over many chained `obscura_search`/`obscura_fetch` calls when a task needs broad coverage
— "scan hundreds, keep the best few."

| Param              | Type           | Default              | Notes                                                                                               |
| ------------------ | -------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `query`            | string         | —                    | Keywords beat full sentences                                                                        |
| `max_candidates`   | int 1–300      | 50                   | Candidates scanned **locally** before ranking — narrow the query past 300, don't widen the crawl    |
| `top_k`            | int 1–50       | 20                   | How many top-ranked pages are actually fetched + excerpted, **concurrently**                        |
| `expand`           | boolean        | on, auto-detected    | Expand the query into several sub-queries via a local model before crawling (needs Ollama)          |
| `sub_queries`      | int 1–10       | 6                    | Max sub-queries expansion may produce — each is a real SearXNG round-trip                           |
| `categories`       | string         | `general,it,science` | SearXNG categories to search, comma-separated (see below — zero extra request cost per category)    |
| `drop_below`       | number 0–10    | 3                    | Curator relevance floor below which a page is dropped outright, not just deprioritized              |
| `target_relevant`  | int 0–50       | 0 (disabled)         | Stop fetching once this many pages are curated relevant — see "Stopping once you have enough" below |
| `include_rejected` | boolean        | false                | Return dropped pages anyway (audit the curator) instead of just the `dropped` count                 |
| `dedupe_similar`   | boolean        | false                | Remove near-duplicate pages via one embedding call — see "Near-dup removal and diversity" below     |
| `diversify`        | boolean        | false                | Reorder kept results for topical diversity (MMR) instead of curator score alone                     |
| `mmr_lambda`       | number 0–1     | 0.5                  | MMR trade-off when `diversify` is set: 1.0 = pure relevance, 0.0 = pure diversity                   |
| `passage_chars`    | int 200–4000   | 800                  | Max chars of excerpted passage per result                                                           |
| `deadline_ms`      | int 1000–55000 | 50000                | Wall-clock budget for the whole call — see "The 60s wall" below                                     |
| `stealth`          | boolean        | on                   | Anti-detection when fetching                                                                        |
| `persist`          | boolean        | false                | Save curated results as notes under `RESEARCH/<topic>/` (requires `topic`) — see below (ADR-0056)   |
| `topic`            | string         | —                    | Slug (`^[\w][\w-]*$`) grouping this research; required with `persist`                               |

**How it stays cheap:** the crawl runs as local CPU/RAM work, not LLM calls — `max_candidates` are
gathered by walking SearXNG's `pageno` server-side (structured JSON, one loopback HTTP round-trip
per page). Only the `top_k` best-ranked pages are fetched via `obscura_fetch`, **concurrently**
(bounded, `OBSCURA_RESEARCH_CONCURRENCY`). `scanned` (candidates gathered) and `fetched` (pages
actually read) come back in the response so the agent can see how deep it searched without paying
for it. Requires a local SearXNG instance for real depth (on-demand by default, see below); without
it, degrades to `obscura_search`'s single-page scrape-chain ceiling.

**No re-ranking (ADR-0057).** Earlier versions re-ranked SearXNG's candidates with local BM25 over
title+snippet — measured against a labelled golden set (`evals/research/`), this was strictly
_worse_ than trusting SearXNG's own order: SearXNG already fuses rank across every engine that
returned a URL, and BM25 over ~30 tokens of SEO snippet threw that signal away. The fetch order is
now exactly what SearXNG delivers.

**Query expansion (ADR-0057) — the main lever for finding an answer that doesn't share the query's
own vocabulary.** A single local model call (`OBSCURA_OLLAMA_EXPAND_MODEL`, default
`qwen3.5:4b-q4_K_M` — deliberately _not_ the curation model: expansion is a recall task, "does the
model already know the canonical term for this," which measurably needs a different model than
reading-comprehension curation does) turns the asker's question into several English,
canonically-worded sub-queries, searched against `categories` in one SearXNG call each (multiple
categories cost nothing extra — SearXNG fans a category list out internally). `it`/`science` add
site APIs (GitHub, MDN, arXiv, Semantic Scholar) that keep answering when general-purpose search
engines are rate-limited, and that don't themselves get rate-limited. Absent the expansion model,
the tool correctly does _not_ expand rather than expand badly — measured, expanding with a small
generic model found zero extra answers while doubling social-media noise in the candidate pool.
`queries`/`concept` come back in the response only when expansion actually ran. Repeating the same
query (iterating a topic, or `obscura_search`'s `translate`) is served from a short-lived cache
(`OBSCURA_EXPAND_CACHE_TTL_MS`, default 10 min) instead of re-dialing the local model — a thrown call
is never cached, so a failure is retried next time, not remembered.

**Curation, page by page, and it now actually removes the garbage (ADR-0055, reversed in
ADR-0057 §6).** If a local [Ollama](https://ollama.com) is available (same default host as
`vkm-spec`'s spec-drafting pass), each of the `top_k` fetched pages is curated **one at a time**:
its text goes to the local model with the query, asking it to understand and relate the page — not
keyword-match it — and return a banded `relevance: 0-10` + a one-line `reason`, plus a verbatim
excerpt when relevant. A page's full text is never accumulated across pages and never reaches the
agent, only the curated excerpt does. Results scored below `drop_below` are **dropped**, not just
sorted last — `dropped` reports the count; `include_rejected:true` brings them back for auditing.
No Ollama, or a single page's curation call fails → that page falls back to the deterministic
`extractPassage` heuristic — the tool never stops working, curation quality just varies.

**Final order is the curator's own score**, not a single relevant/not-relevant bit: a page scored 9
outranks one scored 4. Unread pages (never fetched, or fetch failed) sort between confirmed and
rejected — unknown is neither.

**Hidden content is stripped before anything reads it.** Verified live: a page hiding text behind
`display:none`/`aria-hidden` had that text pass straight through obscura's own `--dump markdown` (and
`--dump text`) as if it were visible — including a prompt-injection-shaped payload, which this
package's own injection scanner also failed to flag, since it only scans visible-looking text. Every
page `obscura_research` fetches is now parsed and stripped of CSS/ARIA-hidden elements,
`<template>` content, and HTML comments (`src/sanitize.mjs`, using `cheerio`) before either the
heuristic extractor or the local curator ever sees it — a class-based hiding rule (as opposed to an
element's own inline `style`/`aria-hidden` attribute) is a named, accepted gap, since catching it would
need a real browser's computed styles. This is scoped to the automated crawl; `obscura_fetch`'s
general single-URL default is unaffected (see its own section above for the opt-in `css_selector`,
which does use the same stripping).

**The 60 s wall (ADR-0057).** The MCP transport itself times out any tool call at 60 s and this
server cannot extend that. `deadline_ms` (default 50000, ~10s of headroom) bounds the whole call;
if it would run over, the response comes back early with `partial:true` and `remaining:N` — the
best-ranked **finished** prefix, never a random sample, since candidates are ordered before any
fetch starts. Depth accumulates across repeated calls on the same topic (a warm SearXNG cache, and
with `persist:true` the `RESEARCH/` bank already dedupes by URL).

**Ban-avoidance (ADR-0057).** The search engines behind `general` are free-tier scrapes that
rate-limit hard and ban by IP for minutes to hours (Cloudflare CAPTCHAs, days) — measured live
during this feature's own development. A banned engine doesn't error, it answers with nothing,
indistinguishable from "no results" unless reported: `enginesUnavailable` surfaces exactly that gap
so "no such page exists" reads differently from "come back in 3 minutes." Repeated crawls on the
same query are served from a local cache instead of re-hitting the engines, and the automated crawl
respects each host's robots.txt (`OBSCURA_RESPECT_ROBOTS=0` to disable; `obscura_fetch`/
`obscura_search` are unaffected — this is scoped to the automated multi-page crawl only).

**Semi-offline: stale-serve on a live failure.** If a SearXNG round or a page fetch fails outright
(the network is genuinely down, not just rate-limited) and a _previous_ result for that exact
(sub-)query/URL is still sitting in the SearXNG or fetch cache — even past its own TTL — that stale
entry is used to keep gathering/curating candidates instead of the round being reported as
`enginesUnavailable`/the page as `fetchFailed`. Set `OBSCURA_CACHE_DIR` to also persist these two
caches (plus `obscura_search`'s own) to disk, so a restarted MCP server starts warm instead of cold
after a crash or an update — unset (the default) is byte-identical to the pre-existing in-memory-only
behavior.
`robotsBlocked` reports how many candidates a host's own robots.txt declined.

**Persisting into `RESEARCH/` (ADR-0056).** `persist:true` + `topic` turns curated results from
ephemeral tool output into a small Markdown bank under `OBSCURA_RESEARCH_DIR/<topic>/` (typed
error if that env var is unset). One verbatim-extract note per curated result goes to
`sources/<hash8-url>-<slug>.md` (frontmatter `url`/`title`/`retrieved`/`query`/`extraction`/
`relevant`/`origin: web`/`status: raw`); a per-topic hub (`_index.md`: query log, open questions)
and the global index (`RESEARCH/_index.md`) are created/updated alongside it. Dedup is by URL
hash8: re-persisting a URL already in the topic updates that note in place (`retrieved` refreshed,
query appended to the hub) — it never duplicates. `fetchFailed` results are never persisted;
`relevant:false` ones are, flag intact, so the agent still makes the final call. The response
gains a `persisted: { topic, written, updated, dir }` receipt; `persist:false` (the default) is
byte-identical to the pre-ADR-0056 tool — no new side effects, no new field. Every write is
root-checked against `OBSCURA_RESEARCH_DIR` first, the same defense-in-depth class as the vault's
own root-lock.

**Mass research actually accumulates across calls (ADR-0057).** With `persist:true` + `topic`,
`RESEARCH/<topic>/sources/` already is a durable record of every URL a previous call banked (one
file per URL, named by its hash). Before crawling, the tool reads that record and skips
already-covered candidates, so `top_k`'s budget goes to genuinely new pages instead of re-fetching
and re-curating ones already on disk — a second call on a well-covered topic reaches further into
the pool rather than returning the same top hits. `alreadyCovered` reports how many candidates
were skipped this way. This is the same idea as a resumable crawler's on-disk "seen" set, reusing
the research bank that already exists rather than a second bookkeeping mechanism.

**Stopping once you have enough (ADR-0057).** Left at its default, a call spends its whole
`top_k`/`deadline_ms` budget regardless of how quickly it finds good results — every candidate gets
fetched and curated even after the curator has already confirmed plenty of relevant pages.
`target_relevant` makes the call recognize "enough good info" on its own: once that many pages have
been genuinely curated as relevant (a real curator verdict at or above `drop_below`, never a
heuristic-fallback guess or a page that was merely fetched), it stops dispatching further
candidates and returns early. The response reports `targetReached:true` so a short result reads as
"you got what you asked for", not as a cutoff — `partial`/`remaining` still fire alongside it (there
may genuinely be more candidates left unprocessed), the two are complementary, not exclusive. With
`concurrency` above 1 the count can overshoot the target slightly (a few in-flight pages finishing
around the same tick) — the gate stops new dispatch, it never discards work already underway.

**Near-dup removal and diversity (ADR-0057).** Both off by default (measure-first, matching this
package's own precedent for BM25 reranking and RRF fusion weight — a technique this pipeline has
already shipped and then deleted twice after measuring it didn't help). `dedupe_similar` and
`diversify` share ONE batched embedding call (`OBSCURA_OLLAMA_EMBED_MODEL`, default
`qwen3-embedding:0.6b`) over the FINAL kept results — never per-page, so enabling either costs at
most one extra network round-trip for the whole call, and is skipped outright when too little of
`deadline_ms` remains (a quality enhancement must never be what pushes a call past the MCP
transport's hard 60 s wall) or the embed model isn't pulled — both degrade silently to the plain
curated order. `dedupe_similar` drops a later, lower-ranked page whose embedding is
near-identical (cosine ≥ 0.92) to one already kept — an objective redundancy signal, never a
relevance judgment, so it never touches a page the curator hasn't already confirmed; removed count
comes back as `dedupedSimilar`. `diversify` reorders via MMR (`mmr_lambda`, default 0.5) so a
cluster of near-duplicate high scorers doesn't crowd out a distinct angle the curator also
confirmed — it discounts by similarity to what's already picked, it never rejects a page outright.

**Automating depth beyond one call.** The 60 s wall (above) caps a single call; going deeper than
one `deadline_ms` budget is a calling-agent loop, not new server infrastructure — call
`obscura_research(topic, query, persist:true)` again with the same `topic`, inspect the response's
`alreadyCovered` and `remaining`, and stop once `alreadyCovered` stops growing relative to new
`written` notes (the topic is exhausted for that query) or `remaining` hits 0. Vary `query` across
calls (synonyms, sub-aspects) to widen coverage rather than re-running the identical query, since
`persist`'s dedup means an identical repeat mostly returns `alreadyCovered`. Each round is a normal
tool call under the same 60 s/`deadline_ms` limits above — there is no separate long-running mode,
job handle, or background process to manage.

**There is now also an actual background mode** — see `obscura_research_start` below — for when
15-30 unattended minutes matter more than keeping the calling agent free between rounds.

### `obscura_research_start` / `obscura_research_status` / `obscura_research_stop` — background deep-research jobs (ADR-0060)

A background job that runs **inside the MCP server process** for minutes at a time, the way a
human researcher works a hard question over an afternoon: start from a few seed topics, then
iteratively branch into subtopics, correlated areas, cross-domain analogies, and application/
improvement ideas — every branch generated and filtered against one stated objective, never just
keyword-matched to the seed topics' own wording. `obscura_research_start` returns **immediately**
(a `job_id`, in milliseconds) — the MCP transport's 60 s wall never applies here, because nothing
waits on the wire; the loop runs detached and only reports progress when polled.

```js
obscura_research_start({
  objective:
    "Evaluate whether MMR diversification is worth adding to obscura_research's kept results",
  topics: [
    "maximal marginal relevance search",
    "diversity vs relevance trade-off IR",
    "MMR reranking benchmarks"
  ],
  topic: "mmr-for-research",
  budget_minutes: 15
});
// -> { job_id: "deep-...", state: "running", topic: "mmr-for-research", ... }

obscura_research_status({ job_id }); // cheap, instant, in-memory snapshot — poll as often as you like
obscura_research_stop({ job_id }); // optional: graceful early stop
```

| Param            | Type             | Default                               | Notes                                                                                                                         |
| ---------------- | ---------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `objective`      | string           | —                                     | The goal every generated subtopic/analogy/application lead is filtered against — not just the seed topics' literal wording    |
| `topics`         | string[]         | —                                     | 1-6 seed queries; each becomes a root of the run's query genealogy                                                            |
| `topic`          | string           | —                                     | Slug (`^[\w][\w-]*$`) grouping the run under `RESEARCH/<topic>/` — same rule as `obscura_research`'s `persist` topic          |
| `budget_minutes` | int 3-30         | 15                                    | Total wall-clock budget for the whole job; winds down gracefully once elapsed (the in-flight round still finishes)            |
| `round_ms`       | int 20000-300000 | env `OBSCURA_DEEP_ROUND_MS` or 100000 | Deadline for a single round (one query's crawl+curate) — lower to cycle more queries, raise to let each dig deeper            |
| `pace_ms`        | int 0-120000     | env `OBSCURA_DEEP_PACE_MS` or 15000   | Politeness pause between rounds — doubles automatically once a round looks banned (see below)                                 |
| `max_depth`      | int 0-4          | 2                                     | How many lead-generation hops from a seed topic the job still follows; `0` = research only the seed topics, generate no leads |
| `top_k`          | int 1-50         | 12                                    | Pages fetched + excerpted per round (same knob as `obscura_research`, lower default since a job runs many rounds)             |
| `max_candidates` | int 1-300        | 60                                    | Candidates scanned per round before ranking                                                                                   |
| `sub_queries`    | int 1-10         | 4                                     | Max query-expansion sub-queries per round                                                                                     |
| `drop_below`     | number 0-10      | 3                                     | Curator relevance floor below which a page is dropped                                                                         |
| `passage_chars`  | int 200-4000     | 800                                   | Max chars of excerpted passage per result                                                                                     |
| `categories`     | string           | `general,it,science`                  | SearXNG categories per round                                                                                                  |
| `stealth`        | boolean          | on                                    | Anti-detection when fetching                                                                                                  |

**Each round reuses `deepResearch` whole** — same expansion, gather, curation, sanitization,
ranking, and `excludeHashes` accumulation described above for `obscura_research`; nothing about the
crawl itself is reimplemented. What's new is the loop around it: after a round finds curated-
relevant results, a local model call (`generateLeads`, zero-shot, running on the same
`OBSCURA_OLLAMA_EXPAND_MODEL` used for query expansion — proposing new directions is a recall task,
not reading comprehension, the same reasoning ADR-0057 §5 already applied to expansion) reads the
objective plus the round's findings and proposes up to 5 next queries, each typed as exactly one of
`subtopic` (digs deeper into something the findings surfaced), `related` (a correlated area not yet
covered), `analogy` (a technique from a different field that plausibly transfers), or `application`
(a concrete use/improvement/feature idea) — each with a one-line `why` tying it back to the
objective. A proposed lead that's a near-duplicate of anything already searched or queued (text
similarity ≥0.85) is dropped rather than queued again.

**Pacing and ban-avoidance escalate together (ADR-0057 §6, applied to a much longer run).** A round
that comes back `scanned:0` with engines reported unavailable counts as banned — a fully-suspended
SearXNG answers HTTP 200 + empty results, indistinguishable from "no hits" otherwise. Two banned
rounds in a row stop the whole job (`engines_suspended`) instead of grinding a banned machine for
whatever budget remains; `pace_ms` doubles the moment the first one happens. **Only one job runs at
a time** — starting a second while one is active is rejected outright, since an unattended job's
own fan-out is exactly the volume that gets this machine banned by search engines in the first
place.

**Requires `OBSCURA_RESEARCH_DIR`**, checked and failed fast at `start` — the same requirement
`persist:true` has above, but checked immediately rather than only discovered when an
already-running 15-30 minute job reaches its own report-write step.

**Every round persists as it finishes** (a killed MCP process loses only the round in flight, never
already-banked work), and a run report is written to `RESEARCH/<topic>/runs/<timestamp>.md` on
**every** exit path — a clean finish, a graceful stop, budget exhaustion, the round cap, engine
suspension, or an outright failure. The report has a round-by-round table, a query genealogy
(which lead spawned which query, and why), the top curated findings, and an "Unexplored leads"
section — always present, even when empty — listing whatever was still queued when the job
stopped, which is where an application or improvement idea the job generated but never got to
chase actually surfaces. Once a job finishes, `obscura_research_status`'s response points at the
report and reminds you to run `/vkm-research <topic>` to consolidate it, the same second half of
dual consolidation `obscura_consolidate` (below) already uses.

New env knobs, both optional: `OBSCURA_DEEP_ROUND_MS` (default `100000`) and
`OBSCURA_DEEP_PACE_MS` (default `15000`) — both are also overridable per call (`round_ms`/
`pace_ms`) without touching the environment.

### `obscura_crawl_start` / `obscura_crawl_status` / `obscura_crawl_stop` — seed-URL site crawler (ADR-0062)

The complement to `obscura_research`: that one **discovers** pages by querying a search engine; this
one **follows a site's own internal `<a href>` links** breadth-first from your seed URLs. Use it to
pull down a whole docs/tutorial/community site **with source attribution** — the "crawl these sites
and keep who wrote what" job the search-driven crawl structurally can't do. A background job (like
`obscura_research_start`): `start` returns a `job_id` immediately and the crawl runs detached, so the
60 s MCP wall never applies; poll `obscura_crawl_status`, stop early with `obscura_crawl_stop`.

```js
obscura_crawl_start({
  seeds: ["https://docs.example.com/"],
  topic: "example-docs",
  allow: ["docs.example.com"], // default: the seed hosts (stay on-site)
  max_depth: 3,
  keywords: ["optimization", "tuning"] // optional keep-filter (traversal is unaffected)
});
// -> { job_id: "crawl-...", state: "running", topic: "example-docs", ... }
obscura_crawl_status({ job_id }); // { totals, currentUrl, gatedUrls, exportPaths, recentPages }
obscura_crawl_stop({ job_id }); // graceful: in-flight page finishes, then export+report written
```

| Param             | Type         | Default          | Notes                                                                                                                                |
| ----------------- | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `seeds`           | string[]     | —                | 1-50 absolute http(s) seed URLs to start from                                                                                        |
| `topic`           | string       | —                | Slug (`^[\w][\w-]*$`) grouping under `RESEARCH/<topic>/` — use a distinct slug per crawl                                             |
| `allow`           | string[]     | seed hosts       | Domain / host+path-prefix allowlist (e.g. `docs.foo.com`, `foo.com/guide`); a `/` = prefix rule, a bare host also matches subdomains |
| `max_depth`       | int 0–6      | 3                | Link hops from a seed; 0 = only the seeds                                                                                            |
| `max_pages`       | int 1–5000   | 200              | Hard ceiling on pages fetched                                                                                                        |
| `keywords`        | string[]     | —                | Keep-filter: only pages whose text contains ANY keyword are persisted/exported (traversal still reaches them)                        |
| `download_assets` | boolean      | true             | Download kept pages' PDFs/images (see envelope below); set false to skip                                                             |
| `asset_max_count` | int 0–5000   | 200              | Total assets to download across the crawl (0 = unlimited)                                                                            |
| `asset_max_bytes` | int          | 26214400 (25MiB) | Per-asset size cap; larger files skipped                                                                                             |
| `per_host_cap`    | int          | 0 (unlimited)    | Max NEW links enqueued per host — bound a sprawling host                                                                             |
| `budget_minutes`  | int 1–60     | 15               | Total wall-clock budget; winds down gracefully after                                                                                 |
| `pace_ms`         | int 0–120000 | 1000             | Politeness pause between page fetches                                                                                                |
| `respect_robots`  | boolean      | true             | Obey each host's robots.txt for pages AND assets                                                                                     |
| `stealth`         | boolean      | on               | obscura anti-detection when fetching                                                                                                 |

**Source attribution + export (requirement ②).** Each kept page's `url`/`title`/**`author`**/
**`published`** (read from OpenGraph/`<meta>`/`<time>`/JSON-LD) go to `RESEARCH/<topic>/sources/`
as notes **and** to a machine-readable `crawl.json` (full rows, incl. downloaded assets) +
`crawl.csv` (flat, RFC-4180-quoted) under `RESEARCH/<topic>/`.

**Resumable (requirement ③).** The crawl's "seen" set is the topic's `sources/` bank
(`listCoveredHashes`) — re-running the same `topic` skips URLs a previous run already banked, so an
interrupted crawl resumes reaching _new_ pages instead of re-walking covered ground. No separate
state file.

**Asset download — strict envelope.** Kept pages' PDFs/images land in `RESEARCH/<topic>/assets/`,
subject to: **Content-Type allowlist** checked against the response header (PDF + raster images
only — **SVG excluded** as scriptable XML), a **per-file byte cap enforced by streaming** (aborts
mid-body past the cap), a **total count cap**, robots respected per asset, a sanitized hash-prefixed
filename root-checked under the assets dir, and the file **written as inert data, never opened or
executed**.

**The boundary — never defeats a wall.** This crawler has no code to solve a CAPTCHA or bypass a
login/paywall. A page that comes back as a Cloudflare/reCAPTCHA/login/paywall interstitial is
recorded `blocked: gated`, its links are **not** followed, and it is listed in the run report's
"Gated pages (need your own login)" section — so you can fetch it with your **own** authorized
access. This back-off-when-blocked posture is also what keeps the machine's IP from being banned.

**One background job at a time.** A crawl and an `obscura_research_start` job cannot run
concurrently (shared slot) — concurrent fan-out is what gets the machine rate-limited. Requires
`OBSCURA_RESEARCH_DIR` (checked at `start`). A run report lands in `RESEARCH/<topic>/runs/` on every
exit path; `/vkm-research <topic>` consolidates.

### `obscura_consolidate(topic, force?)`

The local, 0-token half of dual consolidation (ADR-0056) — the other half is Claude's own
`/vkm-research` skill (`create-vkm-kit`). Reads `OBSCURA_RESEARCH_DIR/<topic>/sources/` and
drafts/refreshes `summary.md` via the same local Ollama client as curation, map-reducing sources
in ≤12,000-char batches without splitting a note across a batch boundary.

| Param   | Type    | Default | Notes                                                   |
| ------- | ------- | ------- | ------------------------------------------------------- |
| `topic` | string  | —       | Slug of an existing research topic                      |
| `force` | boolean | false   | Regenerate an existing `status: draft-local` summary.md |

Writes `summary.md` with frontmatter `status: draft-local`, `generated`, `model`, `sources`, and
returns `{ sources_read, truncated, model, wrote }`. A `status: consolidated` summary (written by
`/vkm-research`) is **never** overwritten — not even with `force` — that's a typed rejection; only
Claude promotes a topic to `consolidated`. No Ollama available → `OllamaUnavailableError`, no
heuristic fallback (unlike per-page curation, a paraphrased draft has no honest deterministic
substitute). Empty `sources/` → typed error.

## SearXNG, started on demand

SearXNG doesn't run in the background. `ensureSearxng()` (`src/ensure-searxng.mjs`) starts the local
instance the moment `obscura_search` needs it and stops it after `OBSCURA_SEARXNG_IDLE_MS` (default
90 s) of no searches — nothing runs while idle, and search still works whether or not a monitor window
is open. Cold start after idle costs ~5–6 s; bursts within the idle window don't re-pay it. When
SearXNG isn't installed it falls back to scraping.

One-time setup (Windows, no Docker) and the full env-var reference live in
[`searxng/README.md`](searxng/README.md). A stdlib-only **desktop monitor** (`searxng/searxng-gui.pyw`)
shows live up/idle status and a feed of what the agent has searched.

## Install

```bash
npx @vkmikc/create-vkm-kit --obscura        # add the obscura web MCP
npx @vkmikc/create-vkm-kit --full           # everything, obscura included
```

The installer downloads the **pinned, SHA-256-verified** obscura binary into `~/.vkm/obscura/` and
registers this server. It's best-effort and opt-in: if the download/verify is skipped or fails, the
tools simply steer to the native ones — the install never breaks.

## Environment

| Var                                                        | Purpose                                                                                                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBSCURA_BIN`                                              | Absolute obscura binary path (installer sets it; else `obscura` on PATH)                                                                                                     |
| `OBSCURA_STEALTH=0`                                        | Disable anti-detection (default on)                                                                                                                                          |
| `OBSCURA_FETCH_TIMEOUT_MS`                                 | Per-fetch navigation budget (default 30000)                                                                                                                                  |
| `OBSCURA_FETCH_MAX_CHARS`                                  | Cap on returned page size (default 60000)                                                                                                                                    |
| `OBSCURA_FETCH_RETRIES`                                    | Extra attempts for a transient `obscura_fetch`/`obscura_fetch_many` failure (default 2; 0 disables retry)                                                                    |
| `OBSCURA_FETCH_RETRY_BASE_MS`                              | Retry backoff base — attempt N waits `base*2^N` + jitter (default 500)                                                                                                       |
| `OBSCURA_SEARCH_ENGINES`                                   | Comma list overriding the scrape chain (default `duckduckgo,bing,brave,mojeek,marginalia,ecosia,bing-rss`, rotated in order; `startpage` also available; add/reorder/remove) |
| `OBSCURA_SEARXNG_URL`                                      | Point search at a SearXNG directly (`""` disables; bypasses on-demand)                                                                                                       |
| `OBSCURA_SEARXNG_{PORT,PY,SRC,SETTINGS,IDLE_MS,AUTOSTART}` | On-demand SearXNG paths/timing (see `searxng/README.md`)                                                                                                                     |
| `OBSCURA_RESEARCH_OLLAMA=0`                                | Disable local-LLM curation in `obscura_research` (default on, auto-detected)                                                                                                 |
| `OBSCURA_OLLAMA_HOST`                                      | Ollama host (default `http://127.0.0.1:11434` — same as `vkm-spec`)                                                                                                          |
| `OBSCURA_OLLAMA_MODEL`                                     | Curation model (default `phi4-mini:3.8b-q4_K_M` — chosen by bake-off, ADR-0057 fifth addendum)                                                                               |
| `OBSCURA_OLLAMA_EXPAND_MODEL`                              | Query-expansion model (default `qwen3.5:4b-q4_K_M` — deliberately not the curation model)                                                                                    |
| `OBSCURA_EXPAND_CACHE_TTL_MS`                              | How long a repeated `expandQuery`/`translateQuery` call is served from cache instead of re-dialing Ollama (default `600000`)                                                 |
| `OBSCURA_OLLAMA_EMBED_MODEL`                               | Embedding model for `dedupe_similar`/`diversify` (default `qwen3-embedding:0.6b`)                                                                                            |
| `OBSCURA_OLLAMA_KEEP_ALIVE`                                | How long Ollama keeps the model loaded after a research call (default `5m`)                                                                                                  |
| `OBSCURA_RESEARCH_DEADLINE_MS`                             | Wall-clock budget for one `obscura_research` call (default `50000`; the MCP wall is 60000)                                                                                   |
| `OBSCURA_RESEARCH_CONCURRENCY`                             | Concurrent page fetches during research (default 4)                                                                                                                          |
| `OBSCURA_RESEARCH_HOST_CAP`                                | Max candidates any one host may hold in the fused pool's head (default 3; 0 disables)                                                                                        |
| `OBSCURA_RESEARCH_NEAR_DUP_THRESHOLD`                      | Cosine similarity above which `dedupe_similar` treats two pages as duplicates (default 0.92)                                                                                 |
| `OBSCURA_SUBQUERY_CONCURRENCY`                             | Concurrent SearXNG sub-queries during expansion (default 2 — ban-avoidance, not just speed)                                                                                  |
| `OBSCURA_SEARXNG_CATEGORIES`                               | Default SearXNG categories for research (default `general,it,science`)                                                                                                       |
| `OBSCURA_RESEARCH_DROP_BELOW`                              | Curator relevance floor below which a page is dropped (default `3` of 10)                                                                                                    |
| `OBSCURA_SEARXNG_CACHE_TTL_MS`                             | How long a SearXNG search response is cached inside `obscura_research` (default `600000`)                                                                                    |
| `OBSCURA_RESEARCH_FETCH_CACHE_TTL_MS`                      | How long a fetched page is cached inside `obscura_research` (default `300000`)                                                                                               |
| `OBSCURA_RESPECT_ROBOTS=0`                                 | Disable robots.txt compliance in the research crawl (default on; never affects `obscura_fetch`)                                                                              |
| `OBSCURA_ROBOTS_CACHE_TTL_MS`                              | How long a host's robots.txt is cached (default `3600000`, 1h)                                                                                                               |
| `OBSCURA_DEEP_ROUND_MS`                                    | Default per-round deadline for `obscura_research_start` jobs (default `100000`; range 20000-300000)                                                                          |
| `OBSCURA_DEEP_PACE_MS`                                     | Default pause between rounds for `obscura_research_start` jobs (default `15000`; doubles on a banned round)                                                                  |
| `OBSCURA_RESEARCH_DIR`                                     | Root for `persist`/`obscura_consolidate`/`obscura_research_start` writes (installer defaults it to `<vault>/RESEARCH`)                                                       |
| `OBSCURA_SEARCH_CACHE_TTL_MS`                              | TTL for `obscura_search`'s own per-query cache (default `300000`); `0` is valid ("never fresh, only ever stale-serve")                                                       |
| `OBSCURA_CACHE_DIR`                                        | Persist the search/SearXNG/fetch caches to disk here (opt-in; unset = in-memory only, the pre-existing default)                                                              |
| `OBSCURA_CIRCUIT_FAILURE_THRESHOLD`                        | Consecutive fetch failures on one host before `obscura_research`/`obscura_crawl_start` stop trying it for this call (default 3)                                              |
| `OBSCURA_CIRCUIT_COOLDOWN_MS`                              | How long a host's circuit stays open once it trips (default `60000`)                                                                                                         |

## Security

- **Untrusted by construction.** Fetched pages and result snippets are wrapped as untrusted web DATA
  and scanned for prompt-injection; the agent treats them as information, never instructions.
- **No open port.** obscura is invoked per-request (`obscura fetch`), not as a persistent CDP server.
- **No shell.** Every spawn uses an argv array; only http(s) URLs are accepted, so a crafted "url"
  can't become a flag or reach a shell.
- **Third-party binary, pinned + hashed.** The kit downloads a version-pinned obscura release and
  verifies its SHA-256 against a baked-in digest, refusing to run an unverified binary. obscura is a
  third-party binary the kit **cannot audit** — a residual supply-chain risk documented in
  [ADR-0051](../../docs/adr/0051-obscura-web-stealth-browser.md) and [`SECURITY.md`](../../SECURITY.md).

## Testing

```bash
npm test -w @vkmikc/obscura-web
```

Covers the SERP parsers against fixtures (including a generic-extraction fixture simulating an
engine markup redesign), the layered fallback chain, the SearXNG on-demand lifecycle (injected
spawn/fetch — no real server), robots.txt compliance, the untrusted-web envelope, a deadline-aware
crawl (injected clock, no real sleeping), ban-avoidance (caching, throttling, category fan-out —
all measured against a live rate-limit this feature's own development triggered), and the MCP
handlers over an in-memory transport, including the ADR-0057 param surface (`expand`/`sub_queries`/
`categories`/`drop_below`/`deadline_ms`) and response fields (`partial`/`enginesUnavailable`/
`robotsBlocked`). The background job registry (`obscura_research_start`/`_status`/`_stop`) has its
own suite — injected clock and `deepResearch`/`generateLeads`/persist implementations, no real
timers or network — covering round pacing, lead near-dup filtering, the singleton-job guard,
`engines_suspended` detection, and `renderRunReport`'s output on every exit path
(`test/deep-research.test.mjs`, `test/deep-research-mcp.test.mjs`, `test/generate-leads.test.mjs`,
`test/run-report.test.mjs`). A separate offline CI gate (`test/bench-gate.test.mjs`) runs the real crawl over
frozen SearXNG fixtures (`evals/research/`) and asserts it holds its measured retrieval floor — see
`packages/obscura-web/src/bench-run.mjs` for the full per-arm decomposition and
`docs/adr/0057-obscura-research-gather-over-rank.md` for what it measured.

Also covered: `obscura_fetch`'s retry/backoff on a transient failure and non-retry on `ENOENT`/a
permanent error (`test/obscura-cli.test.mjs`); the `expandQuery`/`translateQuery` cache's hit/miss/
never-caches-a-throw contract (`test/expand-query.test.mjs`, `test/ollama-client.test.mjs`); the
Yahoo/Qwant engine registrations (`test/serp.test.mjs`); the SERP-parser canary's per-engine ok/fail
logic against injected fixtures, no live network (`test/canary.test.mjs`); the disk-cache primitives
— atomic write, corrupt/missing-file degradation — in isolation (`test/persistent-cache.test.mjs`);
and the stale-serve fallback end-to-end (a live failure with a pre-existing cache entry is served
instead of erroring) in both `test/serp.test.mjs` and `test/research.test.mjs`.

## License

vkm-kit is MIT + attribution ([`LICENSE.md`](LICENSE.md)). **obscura** is third-party, Apache-2.0
([h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura)) — the kit **downloads** the official
release and verifies it, it does not bundle or redistribute it. **SearXNG** is AGPL-3.0 and is run as a
**user-installed** local instance; it is likewise not bundled.
