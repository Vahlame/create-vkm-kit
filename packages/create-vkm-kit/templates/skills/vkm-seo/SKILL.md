---
name: vkm-seo
description: Brutal, measurable SEO for websites — build or audit pages that rank for multiple queries (synonyms, variants, locations) and stay visible in AI search (GEO/AEO). Runs the bundled static audit before/after every change. NOT for non-web deliverables or ad/SEM campaigns.
user-invocable: true
---

# vkm-seo — rank on evidence, not on vibes

Installed by create-vkm-kit (vkm-kit). One job: when a website is being built or reworked,
**optimize it for search brutally and measurably** — semantic coverage of synonyms/variants,
clean technical foundations, structured data, and AI-search (GEO/AEO) visibility — with an
executable audit proving every pass instead of "this should rank better now".

## Step 0 — the brief and the tier (always first)

```text
Site:     <what the site is, who it serves, which market/language(s)>
Queries:  <the query FAMILY to win: head term + synonyms/variants/locations>
Constraints: <stack, existing rankings to protect, pages in scope>
```

Then pick the tier — reading more than your tier is the failure, not diligence:

| Tier                                                  | What you read                        | What you do                                              |
| ----------------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| **Micro** — one page's meta/headings/schema           | nothing (audit output is the guide)  | run the audit, fix its findings on that page, re-run     |
| **Standard** — a template or section                  | the reference file for the weak area | audit + entity coverage pass on the template             |
| **Full** — new site, redesign, or "why don't we rank" | both reference files                 | architecture + on-page + technical + schema + GEO passes |

## The loop — measure, fix, re-measure

**1. Audit first.** Before touching anything:

```bash
node ~/.claude/skills/vkm-seo/scripts/seo-audit.mjs <url-or-file.html> --out ./seo-audit
```

Static checks on the delivered HTML, severity-ordered in `seo-audit/report.json`: title and
meta-description presence + length windows, `noindex` traps, canonical, `<html lang>`,
viewport, H1 count + heading hierarchy, image `alt` coverage, JSON-LD presence + validity,
Open Graph/Twitter cards, hreflang `x-default`, internal links, empty anchors, mixed
content; for live URLs also robots.txt reachability, `Disallow: /` blocks and the
`Sitemap:` line. Checks it could not run are listed `NOT RUN` — never claim them.

**2. Fix errors before warnings, causes before symptoms.** A `noindex` or a robots block
outranks every content improvement — nothing else matters until the page CAN rank. Then
metadata, then structure, then coverage.

**3. Semantic coverage, not keyword stuffing.** One page targets one intent and covers its
whole query family (synonyms, variants, phrasings, locations) naturally in headings, body
and anchors; different intents get different pages. Never two pages competing for the same
intent (cannibalization) — merge or differentiate.

**4. Re-run the exact same audit.** Done means: error count 0, warning count stated with
each survivor justified in one line, and the before/after counts quoted to the user.

## What the audit cannot see (do these by hand, honestly)

- **Intent verification:** before targeting a query, look at the actual SERP if web access
  exists — what type of page ranks (guide? product? local pack?) decides what to build. No
  web access → say the intent is assumed, not verified.
- **Content quality / E-E-A-T:** first-hand experience signals, named authorship, sourcing.
  A page of generic filler passes every static check and still loses.
- **Architecture:** internal linking topology, URL strategy, avoiding orphan pages —
  reviewed from the codebase/sitemap, stated in one paragraph.
- **AI search (GEO/AEO):** direct, quotable answers near the top of the page, clean
  extractable structure, consistent entity naming — the audit checks the skeleton
  (headings, schema), not the quotability.

## Rigor — what you may NOT invent

- **No invented metrics.** Search volumes, CTR curves, ranking positions and "ranking
  factor weights" may only be cited from a live tool/source this session — otherwise write
  "unverified". Never fabricate SERP results or competitor data.
- **Leak/trial material is inference, not fact.** Anything derived from the 2024 Content
  Warehouse leak or DOJ-trial exhibits is labeled as leak-inference; Google-confirmed and
  leak-inferred claims never mix in one sentence.
- **Checks that did not run say NOT RUN.** The audit's honesty contract extends to you.
- **No guarantees.** Rankings are an outcome of a contested system; promise the measurable
  inputs (audit clean, coverage done), never the position.

## Token discipline

Do not paste whole audit reports (they are on disk) — quote the counts and decisive
findings. Do not narrate each check. The deliverable is the optimized site plus a
before/after line per page touched.
