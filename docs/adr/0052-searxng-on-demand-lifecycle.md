# ADR-0052: SearXNG search backend — on-demand lifecycle + desktop monitor

- **Status:** Accepted
- **Date:** 2026-07-12
- **Deciders:** maintainer

## Context

ADR-0051 shipped `obscura_search` with a layered backend whose top layer was "a SearXNG JSON
instance **if `OBSCURA_SEARXNG_URL` is set**". In practice, free SERP scraping (DuckDuckGo / Bing /
Brave HTML) cannot be fast + high-volume + relevant at once: rendering each SERP through the stealth
browser is slow, and lightweight RSS/HTML endpoints return off-topic results for technical queries
(measured — a `bing-rss` arm returned package-tracking pages for the query "SWE-bench"). A local
**SearXNG** — which aggregates many engines and returns structured JSON with no anti-bot wall — is
the only backend that meets all three at once.

But leaving it as a manual "set `OBSCURA_SEARXNG_URL` and run the server yourself" was friction the
user rejected: SearXNG should **not** sit in the background eating RAM when nobody is searching, and
the user should be able to game or work — while the agent keeps using its tools — without babysitting
a server. Constraints: Windows-first, **no Docker required**; SearXNG is not officially Windows-native
(it imports the POSIX-only `pwd` module) and ships with its **JSON API disabled** by default.

## Decision

1. **On-demand lifecycle owned by the obscura-web MCP** (`ensureSearxng()`, `ensure-searxng.mjs`).
   `obscura_search` calls it before searching: if nothing serves the port it spawns the local venv
   `searx.webapp`, polls a **real JSON search** for readiness (engines load after the port opens),
   and returns the base URL; an idle timer (`OBSCURA_SEARXNG_IDLE_MS`, default 90 s) stops it after
   the last search. Concurrent searches dedupe on one in-flight start; the child is `unref()`d (never
   keeps the MCP loop alive) and killed on process exit. When it can't start (no local install,
   `OBSCURA_SEARXNG_AUTOSTART=0`) it returns `null` and the caller falls back to the ADR-0051 scrape
   chain. An externally-run instance (`start.ps1`) is detected and used but **never auto-killed**.
   This **refines ADR-0051 §4** ("only if `OBSCURA_SEARXNG_URL` is set").
2. **Default to a local instance.** `searchWeb` defaults `searxngUrl` to `http://127.0.0.1:8888`, so a
   running SearXNG is used with zero env; `OBSCURA_SEARXNG_URL=""` disables it, or points elsewhere
   (a remote / Docker SearXNG, bypassing the on-demand manager).
3. **Reproducible Windows setup committed, not just documented** — `packages/obscura-web/searxng/`:
   `settings.template.yml` (JSON API on, limiter off, loopback bind), `pwd_shim.py` (a stdlib stub for
   the POSIX-only module SearXNG imports at startup), and a README with the exact
   clone/venv/shim/config/run steps.
4. **Desktop monitor, not a controller** (`searxng-gui.pyw`, stdlib-only Tkinter). Because the MCP owns
   the lifecycle, the GUI is a pure monitor: live up/idle status + a feed of what the agent has
   searched (each `obscura_search` appends `{ts, query, source, count}` to
   `~/.vkm/searxng/searches.log` via `search-log.mjs`). Closing the window frees only the window.

## Alternatives considered

- **Keep SearXNG running as a background service:** rejected — the user explicitly wanted zero idle
  footprint; on-demand + idle-stop costs nothing while not searching.
- **GUI-owned lifecycle (SearXNG runs only while the monitor window is open):** rejected — the agent
  would lose structured search whenever the window is closed; MCP-ownership keeps search working
  regardless and leaves the window purely informational.
- **Manual `OBSCURA_SEARXNG_URL`-only (ADR-0051's original):** rejected — friction; a server to start
  and stop by hand.
- **Docker / WSL SearXNG as the default:** kept as an _option_ (point `OBSCURA_SEARXNG_URL` at it), not
  the default — it requires Docker; the bare-Windows venv path is the zero-extra-dependency default.
- **Parse SearXNG's stdout for the monitor feed:** rejected — it only captures searches that hit the
  server the GUI itself started; logging from the MCP (`search-log.mjs`) captures **every**
  `obscura_search` with source + count regardless of who owns the process.

## Consequences

- Positive: structured, relevant, fast search with no manual server management and **no idle cost**;
  works whether the monitor is open or closed; graceful fallback to scraping when SearXNG is absent;
  the setup is reproducible from in-repo files.
- Negative: the **first** search after an idle period pays SearXNG's cold start (~5–6 s measured); the
  Windows path needs a one-time `pwd` shim and a manual clone/venv (SearXNG isn't pip-installable as a
  library); the bundled Flask dev server is single-user (fine for a personal agent, not a shared
  service).
- Neutral: opt-in with obscura (`--obscura`/`--full`); every path is overridable via
  `OBSCURA_SEARXNG_{PORT,PY,SRC,SETTINGS,IDLE_MS,AUTOSTART}`; a Windows libuv teardown assertion on
  hard-exit-after-kill was avoided with `unref()` + a one-tick deferred exit in the signal handlers.

## References

- `packages/obscura-web/src/ensure-searxng.mjs`, `search-log.mjs`, `serp.mjs` (`searxngSearch`),
  `obscura-mcp.mjs`; `packages/obscura-web/searxng/` (`settings.template.yml`, `pwd_shim.py`,
  `searxng-gui.pyw`, `README.md`, `start.ps1`).
- ADR-0051 (obscura-web — this refines its §4 SearXNG layer), ADR-0044 (loopback-only local services),
  ADR-0047 (best-effort/opt-in installer contract).
- SearXNG upstream: <https://github.com/searxng/searxng> (AGPL-3.0). The kit runs a **user-installed**
  local instance; it does not bundle or redistribute SearXNG.
