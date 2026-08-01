# vkm-seo depth — technical, schema, AI search, measurement (phases 4-5 and 7-8)

Depth for Phase 4 (technical SEO), Phase 5 (structured data), Phase 7 (GEO/AEO) and
Phase 8 (measurement and experiment discipline). Research, architecture, on-page and
local depth: see on-page-and-architecture.md, this folder. Source tags (§N) refer to the
distilled source set behind this skill. Dated study figures below are snapshots kept only
with their dates — re-verify before treating any of them as current. "Leak-inference" and
"patent-derived" labels are hypotheses, never confirmed Google behavior.

## Contents

- Phase 4 — Technical SEO (crawlability, CWV, rendering, canonicals, hreflang)
- Phase 5 — Structured data / schema
- Phase 7 — GEO/AEO (AI-search optimization)
- Phase 8 — Measurement and experiment discipline

## Phase 4 — Technical SEO (crawlability, CWV, rendering, canonicals, hreflang)

- Ship critical content, `<title>` and canonical in the initial server HTML — first-wave
  indexing only sees static markup (the render wave can lag minutes to weeks), and AI
  crawlers (GPTBot, ClaudeBot, PerplexityBot) did not render JS at all as of 2025.
  Crawler capabilities evolve; the durable rule is initial-HTML delivery (§2.2, §7.3).
- Prefer SSG (optimal for content sites) or SSR over client-side rendering; dynamic
  rendering is deprecated as a strategy (§7.3).
- Hit Core Web Vitals thresholds on 75th-percentile field data (CrUX): LCP ≤2.5s, INP
  ≤200ms (201-500ms needs improvement, >500ms poor; INP replaced FID on March 12, 2024),
  CLS ≤0.1 (§7.1).
- Treat CWV as a minor tiebreaker between similar-quality pages — content and relevance
  dominate (§7.1).
- Optimize delivery: low TTFB with a CDN, HTTP/2 or HTTP/3, Brotli/gzip, resource hints
  (preload, preconnect, dns-prefetch, fetchpriority), WebP/AVIF images with srcset/sizes
  and native lazy loading, and font-display: swap (§7.2).
- Avoid JS traps: links need a real href (Google does not fire onclick), content behind
  interaction is not indexed, hash (#) routing is invisible — Onely measured up to 9x
  longer crawl time for JS-injected content (313h vs 36h) (§7.3).
- Use robots.txt only to control crawling, never indexing (use noindex meta or
  X-Robots-Tag for that), never block CSS/JS, and know Crawl-delay is ignored by Google
  (§6.9).
- Treat rel=canonical as a hint, not a directive — Google can choose a different
  canonical, and conflicting canonical/hreflang/redirect signals confuse it (§6.10).
- Implement hreflang with BCP 47 codes (es-ES, es-CR, es-419, etc.), full bidirectional
  return tags including self-reference (the missing return tag is error #1), and an
  x-default fallback; a canonical that contradicts hreflang makes Google ignore the
  hreflang (§6.11).
- Match hreflang to actual content — tagging es-MX while using Spain vocabulary/prices
  gets the page deprioritized; often es + en beats many Spanish variants (§6.11).
- Use correct status codes: 410 for permanently gone content (processed faster than 404),
  fix persistent 5xx (damages rankings), and eliminate soft 404s ("not found" pages
  returning 200) (§6.13).
- Enforce HTTPS/HSTS with no mixed content, and maintain mobile/desktop content parity —
  whatever is hidden on mobile does not count under mobile-first indexing (§7.6, §7.7).
- Guard against the most lethal mistakes: accidental noindex shipped to production after
  a deploy, staging indexed (block with auth, not robots.txt alone), redirect chains, and
  sitemaps containing non-indexable URLs (§15).
- Analyze server access logs (filter the Googlebot user-agent, group by status code and
  directory) to find crawl traps; crawl budget is irrelevant for a ~200-page site but
  real for large faceted sites (§7.4, §2.1).

## Phase 5 — Structured data / schema

- Use JSON-LD exclusively for new projects (Google-recommended, separates data from HTML,
  supports @graph and @id); avoid Microdata/RDFa (§8.1).
- Pick the most specific applicable types: Organization/LocalBusiness with subtypes
  (Hotel, LodgingBusiness, TravelAgency, TouristAttraction), plus WebSite+SearchAction,
  BreadcrumbList, Article/BlogPosting, Review/AggregateRating, Offer, ImageObject,
  VideoObject, Event, Service (§8.2).
- Do not expect rich results from FAQPage (lost eligibility for most sites in 2023) or
  HowTo (deprecated in results) — keep them only for their semantic value (§8.2).
- Build a connected entity graph in a single JSON-LD block using @graph and stable @id
  URIs, so Google reconstructs relations: the Hotel @id referenced from the Article
  mentioning it, the author Person with sameAs to LinkedIn (§8.3).
- Add sameAs links to Wikipedia/Wikidata/official profiles on your entities for
  disambiguation and Knowledge Graph association (§4.5, §8.3).
- Validate every deployment with both the Rich Results Test (eligibility) and the Schema
  Markup Validator (full schema.org validation) (§8.4).
- Never mark up content that is not visible on the page — structured-data spam is
  penalizable (§8.4).
- Treat schema as a cost-of-retrieval reducer: machine-readable markup raises the
  probability of rich results, Knowledge Panel inclusion and AI citations (§8.5).
- Baseline (Web Almanac snapshot, dated): JSON-LD adoption ~41% of pages — thorough
  entity markup is still a differentiator (§8.3).

## Phase 7 — GEO/AEO (AI-search optimization)

- Stop equating rank #1 with AI visibility: one SE Ranking study (Aug 2025) found only
  ~14% of URLs cited in AI Mode matched the organic top-10, with ~12.6 links in an
  average answer — snapshot numbers; the durable takeaway is that ranking and being
  cited are decoupled (§13.1).
- Plan for structurally fewer clicks. Pew (68,879 searches, March 2025 data): with an AI
  Overview present, users clicked a traditional result on 8% of visits vs 15% without,
  only 1% clicked links inside the summary, and sessions ended on 26% of summary pages vs
  16% — dated snapshot; the trend is the point (§13.2).
- Expect CTR compression on informational queries. Seer Interactive (3,119 queries, June
  2024-Sept 2025): organic CTR fell 61% (1.76% → 0.61%) and paid fell 68% (19.7% →
  6.34%) on the same queries — dated snapshot (§13.2).
- Prioritize brand mentions over backlinks for AI citations: one Ahrefs correlational
  study (Spearman) put web mentions at 0.664 vs backlinks at 0.218 against AI Overview
  brand visibility, with brand anchors at 0.527 and brand search volume at 0.392 —
  correlation, treat as hypothesis (§13.3).
- Invest in YouTube presence — correlational data (hypothesis, not law) puts YouTube
  mentions at ~0.737 with citations across ChatGPT/AI Mode/AI Overviews, the strongest
  single signal measured, and YouTube is among the most-cited AI Overview sources
  (§13.3, §12.5).
- Tune per platform, as dated 2025 observations that can invert with any model or product
  update: ChatGPT rewarded accumulated brand strength (parametric knowledge plus
  Reddit/Wikipedia/directories), Perplexity rewarded freshness (one study: 82% of
  citations to content updated <30 days vs 37% for old) and niche directories, and Google
  AI Overviews showed the highest brand preference (~59.8% of citations) — re-verify
  before relying on any of these (§13.3).
- Apply the GEO paper's tactics (Aggarwal et al., KDD 2024 — sandbox benchmark: Google
  top-5 plus GPT-3.5 synthesis, may not transfer to live AI search engines): citing
  authoritative sources, adding expert quotations and adding concrete statistics lifted
  visibility up to +40% in-benchmark, while keyword stuffing scored below baseline
  (§13.4).
- Skip llms.txt entirely — Google has stated it does not and will not support it
  (Illyes, July 2025 — dated statement, re-verify before relying on it), and SE
  Ranking's ~300,000-domain study found no citation effect (§13.5).
- Do not block AI crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot) if you want AI
  visibility — blocking removes you from citations; use Google-Extended to control Gemini
  training without affecting Search ranking (§13.6).
- Serve everything AI-relevant in raw HTML — AI crawlers did not render JavaScript as of
  2025 (§13.6, §2.2).
- Chunk content for extraction: self-contained blocks under clear headings, one assertion
  per block, backed by statistics and quotes, written to be quotable (§13.7).
- Structure sections to answer discrete sub-queries extractably — AI Mode decomposes
  queries via aggressive fan-out, and Deep Search can launch hundreds of parallel
  sub-queries (§13.1, §9.5).
- Optimize for Bing as an AI feeder: use IndexNow and Bing Webmaster Tools, since Bing
  powers Copilot and part of ChatGPT; covering Bing also covers DuckDuckGo (§12.1, §12.3).
- Protect yourself where the damage concentrates: non-brand informational queries lose
  the most clicks while branded queries are protected — another reason brand building is
  the durable hedge (§13.2).

## Phase 8 — Measurement and experiment discipline

- Never steer by "average position" — position 1 plus position 50 averages to a
  meaningless "25.5"; track the number of queries in the top-10, impressions/clicks per
  cluster, and AI citation share instead (§14.1, §1).
- Pull GSC data via the API, not the UI — the UI caps at ~1,000 rows with 16 months of
  history and sampling (§14.1).
- Segment GSC queries with regex filters into brand vs non-brand and variant groups
  before drawing conclusions (§14.1).
- Systematically mine striking-distance queries (positions 5-20) via the GSC API grouped
  by page — the maximum-ROI recurring workflow (§16.3).
- Treat rank trackers as trend indicators only (personalization and geolocation distort
  them) and track at city level for local (§14.3).
- Run SEO A/B tests on statistically similar URL groups (control vs variant templates),
  never as user-level A/B — only one page version ever exists for Google (§14.4).
- Calibrate expectations to published base rates: SearchPilot's 2022-2023 tests came out
  ~15% positive-significant, ~75% inconclusive, 7-8% negative-significant, with typical
  time-to-significance of 2-4 weeks (§14.4).
- When using CausalImpact, choose the control group carefully — the wrong control yields
  up to 20% false positives while the right one gets error down to ~0.1% (§14.4).
- Weigh evidence by hierarchy: (1) official Google docs + Quality Rater Guidelines, (2)
  DOJ sworn testimony, (3) Content Warehouse leak (real but weightless — attribute names
  without semantics, weights or production status), (4) transparent experiments, (5) IR
  papers, (6) practitioner opinion — and treat ranking-factor studies as correlational
  with survivorship bias (§14.5).
- Reject anecdotes: a valid experiment has a control group, adequate sample size,
  reported statistical significance, reproducibility, and controls for external factors
  (core updates, seasonality) (§14.6).
- Set realistic timelines: technical fixes show effect in days-weeks; new content needs
  3-6 months to mature — often longer on new domains (the leak's hostAge attribute is
  cited as sandbox evidence: leak-inference on a concept Google denies); brand/link
  authority takes 6-12+ months; core-update recovery usually waits for the next update
  cycle (§17.4, §9.3).
- Diagnose ranking drops differentially: check coincidence with a known core update, a
  recent technical change (noindex, robots, migration), lost links, new cannibalization,
  or a changed SERP (new AI Overview, more ads) — isolate one variable at a time (§15).
- Expect GSC vs GA4 discrepancies (they measure different things); configure organic
  conversions, bot filtering and attribution in GA4 (§14.2).
- Automate the audit loop: Screaming Frog CLI or your own crawler, log analysis with
  pandas, PageSpeed API + GSC API dashboards, and the web-vitals JS library for your own
  RUM (§16.5).
