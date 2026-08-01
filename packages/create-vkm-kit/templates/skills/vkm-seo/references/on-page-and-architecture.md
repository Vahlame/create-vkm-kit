# vkm-seo depth — on-page and architecture (phases 1-3 and 6)

Depth for Phase 1 (intent and entity/synonym coverage research), Phase 2 (information
architecture and URL strategy), Phase 3 (on-page optimization) and Phase 6 (local SEO).
Technical, schema, GEO/AEO and measurement depth: see technical-schema-ai.md, this folder.
Source tags (§N) refer to the distilled source set behind this skill. "Patent-derived" and
"leak-inference" labels mean exactly that: plausible and directionally useful, never
confirmed production behavior — do not restate them as fact.

## Contents

- Phase 1 — Intent and entity/synonym coverage research
- Phase 2 — Information architecture and URL strategy
- Phase 3 — On-page optimization (titles, headings, content)
- Phase 6 — Local SEO and multi-location pages

## Phase 1 — Intent and entity/synonym coverage research

- Target aggregate visibility across a query cluster, not "position #1": build ONE
  exhaustive topic page per intent cluster. An Ahrefs study of ~3M searches found the
  average #1 page also ranked top-10 for hundreds of other relevant queries — dated
  figures, but the durable point stands: one strong page carries a whole cluster (§1, §4.3).
- Never optimize by repeating exact-match keywords or synonyms — stuffing has been
  obsolete since ~2013 (Hummingbird) and now triggers demotions. Cover the topic's
  entities and subtopics so Google's semantic systems map the page to the whole cluster
  (§1, §4.2).
- Run the full research pipeline: seed keywords → expansion (Keyword Planner,
  Ahrefs/Semrush, AnswerThePublic, AlsoAsked, Google Trends) → clustering by SERP
  similarity → intent classification (informational / navigational / commercial /
  transactional / local) (§5).
- Decide consolidate-vs-separate empirically via SERP similarity: if the top-10s of
  several queries share many URLs, that is one intent → one page; if intent differs
  (transactional "car rental" vs informational "how to rent a car"), build separate pages
  (§4.8). This requires looking at the actual SERPs — without web access the split is an
  assumption; say so.
- Mine Google Search Console (Performance → Queries, regex filters) for striking-distance
  keywords at positions ~5-20 — the highest-ROI move for expanding semantic coverage of
  existing pages (§5, §16.3).
- Capture long-tail with one exhaustive page, never one page per long-tail query — that is
  doorway-page territory and penalizable (§5).
- Harvest real user vocabulary from Autocomplete, People Also Ask / "searches related to",
  customer reviews, forums (Reddit, Quora) and support transcripts (§5).
- Build a topical map (central entity + central search intent, core/outer sections) and a
  semantic content network of interlinked pages, minimizing retrieval cost through clean
  structure. This is a practitioner framework — useful discipline, never confirmed by
  Google as a ranking factor (§4.4).
- Reinforce entities: mark the business with sameAs links to Wikipedia/Wikidata/official
  profiles, maintain one canonical "entity home" page for the brand, and connect to
  nearby place entities (§4.5).
- Verify the central entity has the highest salience by running content through the Google
  Cloud Natural Language API (salience score 0-1); if it is not on top, the page "is about
  something else" to an entity-recognition system (§4.5, §16.2).
- Cover the topic's naturally co-occurring vocabulary and related phrases — per the
  phrase-based indexing patent (patent-derived), a document with low query-term frequency
  but multiple related phrases can outrank a higher-frequency document without them (§4.6).
- Use TF-IDF/NLP tools (Surfer, Clearscope, MarketMuse, Frase, NeuronWriter) only as
  coverage checklists, never as score targets — chasing a "content score" produces term
  filler without information gain (§4.7).
- Audit semantic gaps with your own embeddings: embed your page and the top-10 competitors
  (sentence-transformers/BGE/E5), cluster subtopics by cosine similarity, and fill the
  subtopics they cover that you don't (§16.1).
- Add information the top-10 does not already have — the information-gain patent
  (patent-derived) scores documents by how much NEW information they contribute beyond
  what the user already read (§4.6).
- Audit cannibalization in Search Console — multiple own URLs receiving the same query
  dilute signals — and consolidate them (§4.8).

## Phase 2 — Information architecture and URL strategy

- Organize content as pillar-cluster (hub-and-spoke): a pillar page links to detailed
  cluster pages, each linking back to the pillar and cross-linking where relevant (§6.1).
- Keep every important page ≤3 clicks from the home page so internal PageRank reaches it
  (§6.2).
- Place important internal links in prominent editorial context, not footers or banners —
  the Reasonable Surfer patent (patent-derived, 2010/2016; plausible, unconfirmed as
  current production behavior) weights links by click probability: position on page, font
  size, contextual relevance (§6.2, §4.6).
- Use descriptive, varied internal anchor text, never "click here" — Google tracks anchor
  text, and the leak's droppedLocalAnchorCount attribute (leak-inference) suggests some
  internal links are dropped outright (§6.3).
- Prefer subfolders (site.com/blog/) over subdomains to consolidate authority, with
  short, semantic, hyphenated URLs (§6.5).
- Do not attempt PageRank sculpting with nofollow — the PageRank evaporates rather than
  redirecting; broken since 2009 (§6.4).
- Control faceted navigation: noindex low-demand filter combinations, canonical to the
  main version, block irrelevant parameters, and allow indexing only for facets with real
  search demand (§6.6).
- Handle pagination without rel=prev/next (deprecated 2019): make each paginated page
  crawlable and self-canonical (or use "view all" if performance allows), and give
  infinite scroll JS-free paginated URLs (§6.7).
- Keep sitemaps within 50,000 URLs / 50MB each (sitemap index beyond that), include
  accurate lastmod, list only indexable canonical 200 URLs, and add image/video sitemaps
  for visual businesses (§6.8).
- Migrate with 1:1 mapped 301 redirects, no redirect chains (301→301→301), updated
  sitemaps and internal links, and Search Console monitoring (§6.12).
- Route authority deliberately: identify the highest-authority "power pages" and link
  from them to pages you want to boost, using varied semantic anchors (§16.6).
- Prune the site: delete, consolidate or redirect thin and decayed content to raise the
  sitewide average quality — the post-Helpful-Content reality (§16.8).
- Generate programmatic pages only when each carries real data and unique value — empty
  templates at scale are "scaled content abuse" spam (§16.4).

## Phase 3 — On-page optimization (titles, headings, content)

- Write unique, descriptive titles with the main term near the start, ~50-60 characters
  long — mismatched or clickbait titles get rewritten by Google (§16.7).
- Keep the title aligned with target queries — the leak's titlematchScore attribute
  (leak-inference; unknown weight and production status) suggests title-query match is
  still tracked (§3.1).
- Structure each page inverted-pyramid: direct answer at the top, then depth via tables,
  lists, definitions and FAQ blocks to serve multiple intents at once (§9.4).
- Chase featured snippets by answering the question directly in a 40-60 word paragraph
  (or list/table) immediately under an H2 phrased as the question (§9.6).
- Make every section self-contained under a clear, descriptive subheading so it can rank
  independently via passage ranking and answer AI fan-out sub-queries (§9.5).
- Maintain a clean H1-H6 hierarchy with one clear, unique H1 — a weak signal, but good
  practice for machine comprehension (§7.8).
- Use question-form headings covering PAA/AlsoAsked questions to capture People Also Ask,
  related searches and autocomplete features (§4.9).
- Do not chase a fixed word count — no magic length exists; longer content correlates
  with more keywords only because it covers more subtopics (§15, §4.3).
- Content decays: review and refresh the pages that earn traffic on a recurring cycle —
  no evidence supports one fixed cadence — and keep the visible "updated" date honest and
  functional, never decorative (§9.7).
- Score short content by originality, not length — the leak's OriginalContentScore
  attribute (leak-inference; unknown weight and production status) points at originality
  rating for short content (§3.1).
- Use AI to accelerate writing but never for mass filler — Google penalizes scaled
  low-quality content, not AI per se; always add information gain: real experience, own
  data, original photos (§9.8).
- Operationalize E-E-A-T with clear authorship, credentials, citations and external
  mentions — leaked attributes indicate Google stores author information and tries to
  match it to entities (leak-inference on the mechanics; the practice is sound either
  way) (§9.1, §3.1).
- Ignore debunked on-page myths: there is no optimal keyword density %, "LSI keywords" do
  not exist, and meta keywords have been ignored for over 15 years (§15).

## Phase 6 — Local SEO and multi-location pages

- Work the two controllable local pillars — relevance and prominence — and accept that
  distance (proximity) cannot be optimized (§11.1).
- Allocate effort by the Whitespark local ranking survey (2026 edition; 47 practitioners,
  187 factors — averaged expert opinion, not measurement): Google Business Profile
  signals ~32%, review signals ~20%, on-page ~19% (§11.2).
- Fully complete the GBP: precise primary category plus secondaries, services, products,
  attributes, exact hours, many high-quality photos, posts and Q&A (§11.3).
- Keep GBP data consistent — inconsistent info triggers suspensions — and tag GBP links
  with UTM parameters so their traffic is measurable (§11.3).
- Enforce NAP consistency: name, address, phone identical across GBP, website and every
  directory; inconsistencies hurt (§11.4).
- Build citations in local and vertical directories — in hospitality TripAdvisor is
  critical (Perplexity leans on it heavily), plus Booking and regional aggregators (§11.5).
- Run a continuous review program optimizing volume + velocity + response + natural
  keywords in reviews, responding to all — reviews are among the strongest prominence
  signals (§11.6).
- Create one landing page per location/service ONLY with unique, valuable content —
  duplicated templates with just the place name swapped are doorway pages and penalizable
  (§11.7).
- Audit local rankings from the searcher's location using the uule parameter or
  city/state-level geolocated rank tracking — never trust your own personalized SERP
  (§11.8).
- Cover local vocabulary and idioms in the local language plus the languages of your
  visitor markets (e.g. es + en for North American tourists) (§11.9).
- Grow branded searches and unlinked brand mentions as the #1 lever. The Panda patent
  ties ranking to independent inbound links vs reference queries (patent-based
  hypothesis — commentators dispute whether the patent even describes Panda); Fishkin's
  post-leak conclusion: "build a notable, popular, well-recognized brand outside of
  Google search" (§10.6).
