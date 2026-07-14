# Facturio landing — delivery note

## Direction

**The Typeset Ledger** — editorial-print lineage. Concept: *the landing page is a
beautifully typeset invoice.* Chosen over "Paper Instrument" (Swiss spec-sheet) and
"Counter Terminal" (instrument console) because it derives from the product itself —
the artifact Facturio produces IS a typeset financial document, so demonstrating
typographic care is an argument, not decoration. Banned default (named before work):
dark hero, indigo gradient, Inter, pill badge, floating screenshot, three rounded
feature cards, purple "most popular" pricing card.

Capsule deviation (the signature): one instrument element imported into the editorial
page — all money in tabular mono figures, pricing as a ruled ledger table, and a
typeset invoice specimen (pure HTML, no image) with a rotated PAID stamp as the hero
artifact.

## Verified (script output)

- `palette.mjs --hue 85` (neutrals) + `--hue 40 --chroma 0.14` (accent): all tokens
  taken verbatim from generated OKLCH ramps.
- `contrast.mjs --pairs facturio-pairs.json`: **14/14 pairs AA** after one token fix —
  link accent moved from `oklch(0.56 0.14 40)` (4.29:1 FAIL on paper) to
  `oklch(0.51 0.14 40)` (5.27:1 paper, 5.92:1 sheet). Key pairs: body 16.27:1,
  button 6.73:1, chip 8.31:1, footer 12.24:1, stamp 4.81:1, UI accents ≥ 6.0:1.
- `scale.mjs --type 16,22.5,32,45,64,90 --ratio 1.414` → PASS; `--space 8,…,128 --base 8` → PASS.
- `audit-css.mjs index.html`: 7/7 declared pairs PASS (via hex fallback block).
- Rendered checks (localhost, Chromium): no horizontal scroll at 1280 px or 360 px;
  hero/features/footer collapse to 1 column on mobile; pricing ledger scrolls inside
  its own container; h1 clamps 45→64 px; body measure ≈ 52 ch; heading sequence has
  0 level skips; click targets 34–57 px; **zero external/subresource requests**
  (the document is the only fetch); zero console errors.
- Critique pass fixes applied: footer H4→H3 heading skip; sr-only utility split from
  the skip-link class.

## Remains assumption

- Visual loop was **degraded**: the Browser pane's screenshot tool failed after two
  captures (narrow-viewport hero and desktop footer, both correct). Middle sections
  (features, pricing, plea band) were verified by DOM measurement and the static
  audit, not by pixel inspection.
- The hex fallbacks in `@supports not (color: oklch(...))` come from palette.mjs
  output except `--accent-text: #a6431f`, which is interpolated between generated
  steps (approximation; only affects pre-2023 engines).
- Webfont intent (Fraunces + IBM Plex Mono) is declared as an install-note comment,
  not loaded; system-serif rendering (Iowan Old Style / Palatino / Georgia) is what
  was verified.
- Single light "paper" theme is a design decision (a printed document does not
  invert), not an omission — all pairs were computed for it.
- Copy, stats, and prices are plausible fiction (footer says so).
