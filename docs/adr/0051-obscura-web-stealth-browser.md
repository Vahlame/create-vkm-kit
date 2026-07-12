# ADR-0051: obscura-web — stealth web fetch + robust search via a local headless browser

- **Status:** Accepted (shipped in 4.1.0; SearXNG layer refined by ADR-0052)
- **Date:** 2026-07-12
- **Deciders:** maintainer

## Context

The user wanted Claude Code's web access, when the kit is installed, to go through
[obscura](https://github.com/h4ckf0r0day/obscura) — a Rust headless browser with
anti-detection/fingerprint-randomization/tracker-blocking — instead of "searching the normal
way". Two premises had to be corrected first:

1. **obscura is not a search engine or search proxy.** It is a headless browser (a drop-in for
   headless Chrome/Puppeteer/Playwright) that fetches/renders a URL. "Searching" with it means
   scraping a search engine's results page.
2. **Claude Code's `WebSearch`/`WebFetch` run server-side on Anthropic's infra**, not on the
   user's machine — there is no setting/proxy to point them at a local binary. The only viable
   pattern (and the one the kit already uses for memory) is a **local MCP server** that exposes
   new tools, plus guidance to prefer them.

Constraints from the user's decisions this session: scope = fetch **and** search, with search
designed to be non-fragile; the **kit installs and manages the obscura binary** (chosen over
"user installs it") so it works natively post-install; and enforcement is **soft** (obscura
preferred, native tools as fallback — no `permissions.deny`).

## Decision

1. **New package `packages/obscura-web/`** — a stdio MCP server exposing `obscura_fetch`
   (stealth URL fetch/render) and `obscura_search` (robust web search), backed by the local
   obscura binary. Registered for Claude Code / Codex (CLI) and Cursor (`mcp.json`) via the
   existing `mcp-merge.mjs` factory seam, gated to `--obscura`/`--full`.
2. **Per-request `obscura fetch`, not a persistent `obscura serve` CDP server.** obscura's
   `serve` exposes no `--host`/`--bind` flag (verified against v0.1.10's CLI), so a long-lived
   server could not be pinned to loopback; a per-request `obscura fetch <url> --dump markdown
--stealth --quiet` opens **no port at all** and is the safer default for low-volume agent
   use. All spawns use an argv array (never `shell: true`) and only http(s) URLs are accepted,
   so a crafted "url" cannot become an obscura flag or reach a shell.
3. **Soft enforcement via the MCP server's `instructions` + tool descriptions**, not a global
   managed-block bullet and not `permissions.deny`. Each tool advertises "Preferred over the
   native WebFetch/WebSearch"; the server instructions say prefer obscura, fall back to native.
   MCP server instructions are surfaced **only when the server is connected** — i.e. only to
   users who installed obscura — so non-obscura users pay zero token cost, and the drift-gate
   cascade of editing the shared rules block (docs ES/EN + sync-agents + budget) is avoided.
   Every tool failure (missing binary, all sources dead) returns a message that explicitly
   steers the agent back to the native tool.
4. **Layered, non-fragile search** (`obscura_search`): (1) a SearXNG JSON instance if
   `OBSCURA_SEARXNG_URL` is set — structured results, no HTML parsing (the #1 scraper-breakage
   source), aggregating many engines; (2) obscura-rendered multi-engine SERP (DuckDuckGo HTML →
   Bing → Brave — three independent providers, first with results wins) parsed by per-engine
   resilient extractors; (3) a per-query cache + min-interval throttle; (4) the native
   `WebSearch` fallback for the residual. Google is avoided (aggressive anti-bot/CAPTCHA). HTML
   parsing is inherently best-effort — layers 1 and the native fallback carry the dependability.
5. **Third-party binary, pinned + hash-verified.** The installer (`obscura-setup.mjs`, mirroring
   `ollama-setup.mjs`'s best-effort/opt-in contract) downloads the pinned **v0.1.10** release for
   the platform, verifies its **SHA-256** against a baked-in digest, and extracts to
   `~/.vkm/obscura/`. obscura publishes no checksum file, so the digests are computed by us
   (`scripts/obscura-checksums.mjs`) and baked in; until filled, the constant is a placeholder
   and setup **refuses to run an unverified binary** (status `manual`). A mismatch aborts before
   extraction. Setup is best-effort: a skip/failure degrades obscura-web (tools steer to native),
   never breaks the install.
6. **Self-contained package.** obscura-web carries its own small `toolHandler` copy and its own
   web-focused prompt-injection scanner/`wrapUntrustedWeb` rather than importing the canonical
   `obsidian-memory-mcp/src/untrusted.mjs` — this keeps the monorepo's packages decoupled (the
   established convention) and avoids the version-lock footgun of the first cross-workspace
   runtime dependency. Fetched pages and search snippets are wrapped as untrusted web DATA and
   injection-flagged, exactly as vault content is.

## Alternatives considered

- **Persistent `obscura serve` CDP server (port 9222):** rejected — no bind flag to pin it to
  loopback, and it opens a port for a low-volume workload that per-request `fetch` serves with none.
- **Hard enforcement via `permissions.deny` on WebFetch/WebSearch:** rejected — the user chose
  soft; denying the natives leaves no web access at all whenever obscura is down.
- **A global bullet in the managed memory-rules block:** rejected — it would cost tokens for
  every user including those without obscura, and trip the rules-block drift gates; the MCP
  server instructions already scope the "prefer obscura" nudge to exactly the right audience.
- **Scraping Google:** rejected — aggressive bot detection/CAPTCHA; DuckDuckGo/Bing/Brave +
  optional SearXNG are far more scrape-tolerant, especially rendered through obscura's stealth.
- **Importing the canonical injection scanner across packages:** rejected — introduces the first
  cross-workspace runtime dependency and a version-range footgun; a deliberately-scoped copy
  keeps each package independently runnable (a comment cross-links the canonical source).
- **Auto-download without a pinned checksum:** rejected — the kit must never download-and-run an
  unverifiable third-party binary; pin + SHA-256 + refuse-on-mismatch is the floor.

## Consequences

- Positive: obscura users automatically prefer stealth fetch + robust search, with the native
  tools intact as a fallback; no port is opened; the binary is version-pinned and hash-verified;
  zero cost for users who don't opt in.
- Negative: the HTML SERP parsers will drift as engines change markup (mitigated by the SearXNG
  layer + native fallback, and by unit-testing the parsers against fixtures); obscura is a
  third-party binary from a pseudonymous author that the kit pins and hashes but **cannot
  audit** — a residual supply-chain risk the user accepted explicitly; the checksums must be
  recomputed when `OBSCURA_VERSION` is bumped; the two small copies (`toolHandler`,
  injection scanner) can drift from their canonical originals.
- Neutral: opt-in (`--obscura`/`--full`); obscura's CDP port 9222 is unused; a SearXNG instance
  is the user's to run (only its URL is wired).

## References

- `packages/obscura-web/src/` (`obscura-mcp.mjs`, `obscura-cli.mjs`, `serp.mjs`,
  `untrusted-web.mjs`), `packages/create-vkm-kit/src/obscura-setup.mjs`,
  `packages/create-vkm-kit/src/mcp-merge.mjs` (`obscuraWebServer`/`mergeObscuraWebServer`),
  `scripts/obscura-checksums.mjs`.
- ADR-0047 (Ollama installer gating: the best-effort/opt-in pattern mirrored here), ADR-0042
  (version-lock for suite packages), ADR-0044 (loopback-only local services).
- obscura upstream: <https://github.com/h4ckf0r0day/obscura> (v0.1.10, Apache-2.0). The kit
  downloads the official release rather than bundling/redistributing it, and attributes it in
  the README and at install time — so Apache-2.0's redistribution obligations do not attach.
