---
name: vkm-seo
description: Measured SEO for websites — intent and entity coverage, architecture, on-page, technical, schema, local, and AI-search (GEO/AEO) visibility, with a bundled before/after audit script. NOT for paid ads/SEM, social media, or non-web deliverables; NOT a rank tracker or keyword-volume source.
user-invocable: true
---

# vkm-seo — measure, don't opine

Installed by create-vkm-kit (vkm-kit). One job: make a website measurably findable — by
search engines and by AI answer engines — via the eight-phase playbook below, with an
executable before/after audit proving every change instead of "this should rank better now".

## Step 0 — the brief and the tier (always first)

Restate the assignment in three lines, shown to the user:

```text
Site:        <what it is, who it serves, which market/language(s)>
Queries:     <the target query families / entities to win>
Constraints: <stack, pages in scope, rankings to protect>
```

Then pick the tier — reading more than your tier is the failure, not diligence:

| Tier                                                 | What you read                                      | What you do                                       |
| ---------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| **Micro** — one page, one meta/heading/schema fix    | nothing (the audit output is the guide)            | audit → fix its findings → re-audit               |
| **Standard** — a section or template                 | the ONE reference file covering the phases touched | audit + those phases applied to that template     |
| **Full** — whole site, new site, "why don't we rank" | both reference files                               | all eight phases, audit gating every page touched |

## The playbook — eight phases

Depth lives in exactly two files: `references/on-page-and-architecture.md` (phases 1-3
and 6) and `references/technical-schema-ai.md` (phases 4-5 and 7-8). Load per your tier.

1. **Intent & entity coverage.** One exhaustive page per intent cluster — a strong page
   ranks for the whole query family. Cover entities, subtopics and real user vocabulary;
   never repeat keywords (stuffing demotes). Decide merge-vs-split by SERP similarity;
   mine Search Console positions ~5-20 first — the highest-ROI move.
2. **Architecture & URLs.** Pillar-cluster linking; every important page ≤3 clicks from
   home; in-content editorial links with descriptive anchors; subfolders over subdomains;
   controlled facets and pagination; clean sitemaps; 1:1 301 maps on migration; prune
   thin pages.
3. **On-page.** Unique ~50-60-char titles, main term near the start; direct answer at the
   top (inverted pyramid, snippet-ready 40-60-word blocks); self-contained sections under
   descriptive headings (passage ranking + AI fan-out); one H1; no word-count or
   keyword-density targets — both are myths.
4. **Technical.** Critical content, `<title>` and canonical in the initial server HTML —
   first-wave indexing and AI crawlers don't wait for JS. Core Web Vitals field
   thresholds (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1) as a tiebreaker, not a strategy.
   robots.txt controls crawling, never indexing. hreflang needs return tags + x-default.
5. **Structured data.** JSON-LD only; most-specific types; one `@graph` with stable `@id`
   URIs; `sameAs` for entity disambiguation; validate with both the Rich Results Test and
   the Schema Markup Validator; never mark up content invisible on the page.
6. **Local.** Complete Google Business Profile + NAP consistency + a continuous review
   program; a location page only where uniquely valuable (swapped-name templates are
   doorway pages); check rankings from the searcher's location, never your own SERP.
7. **GEO/AEO.** Ranking #1 and being cited by AI are decoupled. Chunk content into
   quotable, self-contained blocks with statistics and sourcing; brand mentions correlate
   with AI citations more than backlinks do (correlational studies — hypothesis, not
   law); serve raw HTML; don't block AI crawlers you want citations from; skip llms.txt
   (Google-confirmed unsupported, as of 2026).
8. **Measurement.** Never steer by average position. GSC API (not UI) with brand vs
   non-brand regex segments, striking-distance mining, template-level SEO A/B with real
   control groups, and the evidence hierarchy: official docs > sworn testimony > leak
   (real but weightless) > transparent experiments > opinion.

## Executable evidence

```bash
node ~/.claude/skills/vkm-seo/scripts/seo-audit.mjs <url-or-file.html> [--out DIR]
```

Run it BEFORE the first change and AFTER the last one — same target, same flags. Checks:
title / meta-description presence + length windows, canonical, robots meta + robots.txt
reachability, sitemap reference, H1 count + heading hierarchy, image alt coverage, JSON-LD
presence + parse, Open Graph/Twitter cards, hreflang set + x-default, internal link count,
`<html lang>`, noindex traps, mixed http:// links. **The before/after error and warning
counts are the deliverable.** Fix errors before warnings — a noindex or a robots block
outranks every content improvement; nothing else matters until the page CAN rank. Checks
the script could not run are listed `NOT RUN` in report.json — never claim a check ran
when it did not.

## Rigor — what you may NOT invent

- **Search volumes, CTR stats, ranking-factor weights, "Google confirmed" claims:** only
  with a live source checked this session — otherwise written as "unverified".
- **Leak-derived attributes** (Content Warehouse, DOJ exhibits): always labeled
  leak-inference — attribute names without weights or production status — never stated as
  confirmed behavior.
- **SERP results and competitor data:** never fabricated. No exceptions.
- **Cannibalization and intent verdicts** require the actual SERP looked at this session,
  or the verdict states the SERP was not checked.
- **No ranking guarantees.** Promise the measurable inputs (audit clean, coverage done),
  never the position — rankings are the output of a contested system.

## Token discipline

Do not paste whole audit reports — report.json is on disk; quote the error/warning counts
and the decisive findings only. One before/after line per page touched. Do not narrate
checks that passed.

## Degradation ladder

No web access → intent, SERP and competitor claims are labeled unverified; the audit still
runs on local HTML files. No shell → run the check list above by hand on the HTML you can
read, and mark everything you could not check `NOT RUN`. Neither → method guidance only,
labeled as such.
