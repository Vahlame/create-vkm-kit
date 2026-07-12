# `@vkmikc/obscura-web`

Stealth web access for your AI agent — an **opt-in** MCP server that fetches and searches the web
through the local [obscura](https://github.com/h4ckf0r0day/obscura) headless browser, preferred over
the native `WebFetch`/`WebSearch` (soft enforcement — the native tools stay as the fallback).

Part of [vkm-kit](../../README.md). Runs from the clone (a private workspace package), wired for Claude
Code, Codex and Cursor by the installer under `--obscura` / `--full`. See
[ADR-0051](../../docs/adr/0051-obscura-web-stealth-browser.md) and
[ADR-0052](../../docs/adr/0052-searxng-on-demand-lifecycle.md).

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

| Var                                                        | Purpose                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `OBSCURA_BIN`                                              | Absolute obscura binary path (installer sets it; else `obscura` on PATH) |
| `OBSCURA_STEALTH=0`                                        | Disable anti-detection (default on)                                      |
| `OBSCURA_FETCH_TIMEOUT_MS`                                 | Per-fetch navigation budget (default 30000)                              |
| `OBSCURA_FETCH_MAX_CHARS`                                  | Cap on returned page size (default 60000)                                |
| `OBSCURA_SEARCH_ENGINES`                                   | Comma list overriding the scrape chain (default `duckduckgo,bing,brave`) |
| `OBSCURA_SEARXNG_URL`                                      | Point search at a SearXNG directly (`""` disables; bypasses on-demand)   |
| `OBSCURA_SEARXNG_{PORT,PY,SRC,SETTINGS,IDLE_MS,AUTOSTART}` | On-demand SearXNG paths/timing (see `searxng/README.md`)                 |

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
