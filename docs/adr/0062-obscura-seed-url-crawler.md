# ADR-0062: obscura seed-URL site crawler (`obscura_crawl_start`)

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** maintainer

## Context

`obscura_research` / `obscura_research_start` (ADR-0054/0057/0060) **discover** pages by querying
a search engine — they walk SearXNG's `pageno` and never follow a site's own internal links. The
user needs the complementary mode: given a few **seed URLs**, follow the site's own `<a href>`
graph and pull down a whole documentation / tutorial / community site, keeping each page's **source
attribution** (URL, title, author, published date) so a later article can cite it. Concretely, from
the request:

1. Follow internal links, render JS, download the relevant content.
2. Preserve the origin of each fragment (URL/title/author/date) for attribution; output JSON/CSV.
3. Configurable: seed URLs, crawl depth, content types (incl. PDFs/images), optional keywords;
   **persist state to resume** if interrupted.
4. Reach content on sites that hide subpages — but the request also named "captchas and login
   walls," which is where a hard boundary applies (below).

None of §1 (link-following) existed. The `deep-research.mjs` "frontier" is a queue of _search
queries_, not _URLs_ — verified in code. So this is a genuine new capability, not a config of the
existing crawl.

## Decision

1. **Three new MCP tools — `obscura_crawl_start` / `obscura_crawl_status` / `obscura_crawl_stop`
   — a BACKGROUND job**, mirroring ADR-0060's deep-research job exactly. A "crawl a whole site"
   run is hundreds of politely-paced fetches = minutes of work, which cannot fit inside one MCP
   tool call (the SDK's 60 s client-side wall). `start` returns a `job_id` in milliseconds and the
   loop runs detached inside the server process; `status` is an in-memory snapshot read; `stop` is
   a graceful cooperative cancel.

2. **A pure BFS engine (`crawl.mjs#crawlSite`) with everything injected** (fetch, robots, persist,
   asset download, export, clock, `shouldStop`/`onPage`), so the whole crawl is unit-testable with
   no network/clock/FS — the same split as `research.mjs` (one unit of work) vs `deep-research.mjs`
   (the job wrapper). `crawl-job.mjs` is orchestration only: state machine, budget→stop, snapshot,
   run report. Nothing about the crawl is reimplemented in the job layer.

3. **Reuse, never re-implement.** Page render = `obscuraFetch(format:"html")`; hidden-content
   stripping = `sanitize.mjs#stripHiddenContent` (the same defense the research crawl uses); dedup =
   `url-identity.mjs#canonicalizeUrl`; per-host compliance = `robots.mjs#checkRobots`; persistence =
   `research-persist.mjs`. **Resumability is free**: `listCoveredHashes(topic)` already IS a durable
   on-disk "seen" set (one file per URL under `RESEARCH/<topic>/sources/`), so a re-run of the same
   topic skips URLs a previous run banked — the resumable-crawler requirement (§3) reusing existing
   state, not a second bookkeeping mechanism.

4. **Source attribution (§2).** `extractMetadata` reads title/author/published from OpenGraph /
   Twitter / standard `<meta>`, `<title>`/`<h1>`, `<time datetime>`, and JSON-LD, with a documented
   precedence. `author`/`published` are added to `persistResults`' frontmatter **additively** —
   emitted only when supplied, so `obscura_research`'s notes stay byte-identical. A machine-readable
   `crawl.json` (full rows incl. downloaded assets) + `crawl.csv` (flat, RFC-4180-quoted) are written
   under `RESEARCH/<topic>/` alongside the notes.

5. **Asset download: opt-in-ON, strict envelope (§3).** Kept pages' PDFs/images are downloaded to
   `RESEARCH/<topic>/assets/` (`download_assets`, default `true`; the user chose "download with
   strict limits" over record-only). The envelope, defense-in-depth (`assets.mjs`): http(s) only;
   a **Content-Type allowlist** checked against the response header, PDFs + raster images only —
   **SVG excluded** as scriptable XML; a **per-file byte cap enforced by streaming** (abort mid-body
   past the cap, so a lying/absent Content-Length can't be exploited); a **total count cap**; robots
   respected for every asset URL; a **sanitized, hash-prefixed, type-forced filename** root-checked
   under the assets dir; and the file is written as inert data, **never opened or executed** —
   matching the vkm-downloads MCP's contract. Binary assets use the platform `fetch`, not obscura
   (obscura streams text through stdout, which corrupts binary; static assets need no JS render).

6. **The boundary — never defeat a wall (§4).** The crawler has NO code to solve a CAPTCHA or
   bypass a login/paywall. `detectGated` scans the rendered body for Cloudflare/reCAPTCHA/hCaptcha/
   login-form/paywall markers (a documented honest subset — obscura returns only the body, not the
   HTTP status or final redirect URL); a gated page is recorded `blocked: gated`, its links are NOT
   followed, and it is listed in the run report's "Gated pages (need your own login)" section so the
   user can fetch it with their **own** authorized access. This is the same back-off-when-blocked
   posture obscura itself takes with Cloudflare, and it is what keeps the machine's IP from being
   banned — the opposite of the request's goal if we fought the wall.

7. **One background network-job at a time, across types (`job-lock.mjs`).** A shared slot both the
   research and crawl registries acquire, so a research job blocks a crawl from starting and vice
   versa. Concurrent fan-out from one machine is exactly what suspends search engines / trips site
   rate-limits (the failure ADR-0057 §6 spends so much code avoiding); running a crawl and a
   research job together doubles that pressure. Each registry keeps its own per-type guard too.

## Alternatives considered

- **A foreground `obscura_crawl` bounded by the 60 s wall:** rejected — it cannot crawl hundreds of
  subpages, which is the actual use case. The background job is the only shape that fits.
- **A separate `CRAWL/<topic>/` bank:** rejected — reusing `RESEARCH/<topic>/` gives the seen-set
  (resumability) and `vault_hybrid_search` recall for free; a distinct topic slug keeps a crawl and
  a research topic separable when the user wants them apart.
- **Downloading assets through obscura (`--dump assets`/`original`):** rejected for binary — obscura
  streams text through stdout, corrupting binary; the platform `fetch` with the strict envelope is
  correct for static PDFs/images.
- **Including SVG in the image allowlist:** rejected — SVG is XML that can carry `<script>`, an
  active-content vector, not an "informative image."
- **Solving CAPTCHAs / evading logins for gated pages:** rejected — out of scope by policy, legally
  risky for the user (ToS/CFAA-class), and the fastest way to get the machine banned. Report-and-skip
  is the honest, safe behavior; the user fetches gated content with their own credentials.
- **Downloading assets via the vkm-downloads MCP:** rejected for the automated path — that server is
  per-file interactive approval, which a detached background job cannot drive; the capped, allowlisted
  downloader is the automatable equivalent. (The user can still use vkm-downloads for the URLs the
  crawler records but doesn't download.)

## Consequences

- Positive: the one crawl mode obscura lacked (site-spider, not search-driven); full source
  attribution + JSON/CSV export; resumable across runs via the existing bank; safe, capped, opt-out
  asset download; the CAPTCHA/login boundary enforced in code AND surfaced in the run report.
- Negative: gating detection is a body-scan heuristic (obscura exposes no HTTP status / final URL) —
  a documented honest subset that can miss a novel wall (costing a wasted fetch, never a bypass
  attempt); class-based (external-stylesheet) hidden content still slips, the same named gap
  `sanitize.mjs` already documents; crawl and research jobs cannot run concurrently (deliberate).
- Neutral: reuses `OBSCURA_RESEARCH_DIR`, `OBSCURA_RESPECT_ROBOTS`, `OBSCURA_ROBOTS_CACHE_TTL_MS`,
  and the stealth env — no new env knobs; opt-in via the same `--obscura`/`--full` package; the
  60 s MCP wall does not apply (background job).

## References

- `packages/obscura-web/src/crawl.mjs` (pure BFS engine + extractors + gating), `crawl-job.mjs`
  (background job registry), `assets.mjs` (capped downloader), `job-lock.mjs` (shared single-job
  slot), `research-persist.mjs` (`writeCrawlExport` + additive `author`/`published`),
  `obscura-mcp.mjs` (the three tools).
- Tests: `test/crawl.test.mjs`, `test/crawl-job.test.mjs`, `test/assets.test.mjs`,
  `test/crawl-export.test.mjs`, `test/crawl-mcp.test.mjs`.
- ADR-0060 (background deep-research job — the pattern mirrored here), ADR-0057 §6 (ban-avoidance /
  one-job-at-a-time rationale extended to the shared slot), ADR-0056 (`RESEARCH/` bank reused for
  persistence + the seen-set), ADR-0051 (obscura fetch/stealth this builds on).
