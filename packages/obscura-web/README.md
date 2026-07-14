# `@vkmikc/obscura-web`

Stealth web access for your AI agent — an **opt-in** MCP server that fetches and searches the web
through the local [obscura](https://github.com/h4ckf0r0day/obscura) headless browser, preferred over
the native `WebFetch`/`WebSearch` (soft enforcement — the native tools stay as the fallback).

Part of [vkm-kit](../../README.md). Runs from the clone (a private workspace package), wired for Claude
Code, Codex and Cursor by the installer under `--obscura` / `--full`. See
[ADR-0051](../../docs/adr/0051-obscura-web-stealth-browser.md),
[ADR-0052](../../docs/adr/0052-searxng-on-demand-lifecycle.md),
[ADR-0054](../../docs/adr/0054-obscura-research-local-deep-crawl.md), and
[ADR-0055](../../docs/adr/0055-obscura-research-local-llm-curation.md).

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

| Param        | Type                                      | Default    | Notes                                                  |
| ------------ | ----------------------------------------- | ---------- | ------------------------------------------------------ |
| `url`        | string                                    | —          | Absolute http(s) URL                                   |
| `format`     | `markdown` \| `text` \| `html` \| `links` | `markdown` | Output form (markdown is clean for reading)            |
| `stealth`    | boolean                                   | on         | Anti-detection (flip default with `OBSCURA_STEALTH=0`) |
| `timeout_ms` | int 1000–120000                           | 30000      | Navigation budget                                      |

Oversized pages are capped (`OBSCURA_FETCH_MAX_CHARS`, default 60000) so a huge document can't flood
the agent's context.

### `obscura_search(query, …)`

Layered, non-fragile web search. Preferred over native `WebSearch`. Returns normalized
`{ title, url, snippet }` results with a `source` field.

| Param     | Type     | Default | Notes                               |
| --------- | -------- | ------- | ----------------------------------- |
| `query`   | string   | —       | Keywords beat full sentences        |
| `limit`   | int 1–20 | 8       | Max results                         |
| `stealth` | boolean  | on      | Anti-detection when rendering SERPs |

**The layers** (first that yields results wins):

1. **Local SearXNG (structured JSON)** — aggregates many engines, no anti-bot wall. This is the fast +
   relevant path; free SERP scraping can't be fast + high-volume + relevant at once. Started **on
   demand** (see below), `source: "searxng"`.
2. **obscura-rendered multi-engine SERP** — DuckDuckGo → Bing → Brave HTML, parsed by resilient
   per-engine extractors, with a per-query cache. Google is avoided (aggressive anti-bot).
3. **Native `WebSearch` fallback** — if every source fails, the tool returns a message that explicitly
   steers the agent back to the native tool.

### `obscura_research(query, …)`

Deep research without spending agent tokens on the crawl (ADR-0054). Preferred over many chained
`obscura_search`/`obscura_fetch` calls when a task needs broad coverage — "scan hundreds, keep the
best few."

| Param            | Type         | Default | Notes                                                                                            |
| ---------------- | ------------ | ------- | ------------------------------------------------------------------------------------------------ |
| `query`          | string       | —       | Keywords beat full sentences                                                                     |
| `max_candidates` | int 1–300    | 50      | Candidates scanned **locally** before ranking — narrow the query past 300, don't widen the crawl |
| `top_k`          | int 1–30     | 8       | How many top-ranked pages are actually fetched + excerpted                                       |
| `passage_chars`  | int 200–4000 | 800     | Max chars of excerpted passage per result                                                        |
| `stealth`        | boolean      | on      | Anti-detection when fetching                                                                     |

**How it stays cheap:** the crawl and ranking both run as local CPU/RAM work, not LLM calls —
`max_candidates` are gathered by walking SearXNG's `pageno` server-side (structured JSON, one loopback
HTTP round-trip per page), then ranked with a local BM25 scorer (candidate pool = corpus, no external
index). Only the `top_k` best-ranked pages are fetched via `obscura_fetch`. `scanned` (candidates
gathered) and `fetched` (pages actually read) come back in the response so the agent can see how deep it
searched without paying for it. Requires a local SearXNG instance for real depth (on-demand by default,
see below); without it, degrades to `obscura_search`'s single-page scrape-chain ceiling — deeper
pagination against DuckDuckGo/Bing/Brave HTML is exactly the fragile, rate-limited path this package
already avoids, so it is not attempted.

**Curation, page by page (ADR-0055):** BM25 alone would only ever keep passages that repeat the
query's own words — the opposite of what research is for, since new/related information often
doesn't share the query's vocabulary. If a local [Ollama](https://ollama.com) is available
(same default model/host as `vkm-spec`'s spec-drafting pass — one shared daemon, nothing extra to
install if you already use `vkm-spec`), each of the `top_k` fetched pages is curated **one at a
time**: its text goes to the local model with the query, asking it to understand and relate the
page — not keyword-match it — and return a verbatim excerpt (or say the page isn't relevant). A
page's full text is never accumulated across pages and never reaches the agent, only the curated
excerpt does. Every result reports `extraction: "ollama" | "heuristic"` and `relevant: boolean`, so
you can see which path a given passage took. No Ollama, or a single page's curation call fails →
that page falls back to the deterministic `extractPassage` heuristic (best keyword match + the
paragraph that follows it) — the tool never stops working, curation quality just varies.

**Final order trusts the smarter signal.** `chosen`'s fetch order comes from BM25 (blind to
meaning); once a page is actually curated, the response is re-sorted so `relevant: true` results
come first — a page Ollama explicitly rejected can no longer outrank one it confirmed, just
because BM25 scored the rejected page's title/snippet higher. Ties keep their BM25 order.

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

| Var                                                        | Purpose                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `OBSCURA_BIN`                                              | Absolute obscura binary path (installer sets it; else `obscura` on PATH)     |
| `OBSCURA_STEALTH=0`                                        | Disable anti-detection (default on)                                          |
| `OBSCURA_FETCH_TIMEOUT_MS`                                 | Per-fetch navigation budget (default 30000)                                  |
| `OBSCURA_FETCH_MAX_CHARS`                                  | Cap on returned page size (default 60000)                                    |
| `OBSCURA_SEARCH_ENGINES`                                   | Comma list overriding the scrape chain (default `duckduckgo,bing,brave`)     |
| `OBSCURA_SEARXNG_URL`                                      | Point search at a SearXNG directly (`""` disables; bypasses on-demand)       |
| `OBSCURA_SEARXNG_{PORT,PY,SRC,SETTINGS,IDLE_MS,AUTOSTART}` | On-demand SearXNG paths/timing (see `searxng/README.md`)                     |
| `OBSCURA_RESEARCH_OLLAMA=0`                                | Disable local-LLM curation in `obscura_research` (default on, auto-detected) |
| `OBSCURA_OLLAMA_HOST`                                      | Ollama host (default `http://127.0.0.1:11434` — same as `vkm-spec`)          |
| `OBSCURA_OLLAMA_MODEL`                                     | Curation model (default `phi4-mini:3.8b-q4_K_M` — same as `vkm-spec`)        |
| `OBSCURA_OLLAMA_KEEP_ALIVE`                                | How long Ollama keeps the model loaded after a research call (default `5m`)  |

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

Covers the SERP parsers against fixtures, the layered fallback chain, the SearXNG on-demand lifecycle
(injected spawn/fetch — no real server), the untrusted-web envelope, and the MCP handlers over an
in-memory transport.

## License

vkm-kit is MIT + attribution ([`LICENSE.md`](LICENSE.md)). **obscura** is third-party, Apache-2.0
([h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura)) — the kit **downloads** the official
release and verifies it, it does not bundle or redistribute it. **SearXNG** is AGPL-3.0 and is run as a
**user-installed** local instance; it is likewise not bundled.
