# Marks — logos, wordmarks, icons, favicons

Load this when the deliverable is an identity mark. Same spine as everything else (designer-mind →
direction → verify), plus the craft that is specific to marks. The brand slop fingerprint in
`direction.md` applies in full: no generic geometric-sans wordmark + abstract swoosh, no 2021
gradient blob.

## First decision: wordmark before symbol

Most brands need a distinctive **wordmark** more than they need a symbol — a symbol earns its
place only when the name must survive at 16px, appear without text, or hang on an app grid. Decide
this explicitly and say why. A wordmark + a favicon-cut of it is a complete, honest identity.

## Wordmark method (the professional shortcut)

1. Set the name in 3–5 real candidate typefaces from the committed lineage capsule
   (`lineages.md`) at large size. Judge with the crit vocabulary — this alone beats drawing
   letters from scratch.
2. Pick one; tighten tracking for lockup use (wordmarks sit tighter than text, −2% to −5%);
   check every adjacent letter pair at display size — fix outlier gaps by hand.
3. Earn distinctiveness with **2–3 deliberate modifications, not twenty**: one cut terminal, one
   joined pair, one replaced counter, a customized letter. Each must be derivable from the
   direction; name what each modification means.
4. Convert to outlined paths for the final artifact — a mark must never depend on a font being
   installed.

## Symbol construction

- **Concept first:** the symbol depicts the organizing idea in ONE move (shape fusion, negative
  space, letterform-as-object). If you need to explain it in more than a sentence, it's an
  illustration, not a mark.
- **Geometry:** build on a grid (48 or 64 units), snap anchors, restrict to 1–2 stroke weights.
  Circles alongside squares need optical compensation — the circle must slightly overshoot the
  square's bounds to look equal (metric equality reads smaller).
- **Optical corrections beat metric truth everywhere:** visually center (a triangle sits left of
  metric center), open tight junctions so they don't clog at small sizes, thin the horizontals
  slightly if the form looks top-heavy.
- **One mark, weights for sizes:** if the detail dies at 16px, design a simplified small-size cut
  instead of shrinking the full mark.

## The test matrix (all of it, every mark)

Render and LOOK — at 16px (favicon), 24px (UI), 48px (app icon), 512px (marketing); in
one-color black, one-color white on dark, and grayscale; on a photo background. A mark that only
works big, in color, on white, is a decoration. If a renderer exists, actually rasterize at
16px — anti-aliasing kills thin strokes and tight counters, and code inspection won't show it.

## SVG hygiene (the deliverable is code)

Single tight `viewBox`; paths outlined (no `<text>`, no font deps); no stray clip-paths or
editor metadata; coordinates rounded to ≤ 2 decimals; mono variant uses `currentColor` so it
inherits context; explicit `width`/`height` omitted so it scales. Favicon set exported from the
small-size cut, not downsampled from the large mark.

## Deliverables of a mark task

The mark(s) as clean SVG (color + mono) · clearspace rule stated in the mark's own units (e.g.,
"x-height of the wordmark on all sides") · minimum-size rule ("never below 16px; below 24px use
the small cut") · the palette pairs it may sit on, contrast-checked with `scripts/contrast.mjs`
for the UI (≥ 3:1 as a meaningful graphic) · one line on what the mark means, derivable from the
direction.
