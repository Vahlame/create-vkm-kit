# Foundations — the numbers behind professional finish

Rules with numbers, not vibes. Every value here is a defensible default you deviate from
_deliberately_ (per the committed direction), never by accident.

## Typography

- **Scale, not ad-hoc sizes.** Pick a ratio and derive every size from a base (usually 16px):
  1.125 (dense apps/data UIs) · 1.2 (product UIs) · 1.25 (balanced marketing) · 1.333–1.414
  (editorial, display-heavy) · 1.5+ (posters, slides). Verify with `scripts/scale.mjs`.
- **Fluid type on the web:** `font-size: clamp(min, calc(base + vw-slope), max)` for display sizes;
  body text stays ≥ 16px and barely fluid.
- **Line height:** body 1.4–1.6; headings 1.05–1.2 (tighter as size grows); never the same
  line-height token for both.
- **Measure:** 45–75 characters per line for body (`max-width` in `ch` is the honest unit).
- **Optical corrections:** display sizes get negative tracking (−1% to −3%); ALL-CAPS and
  small-caps get positive tracking (+3% to +8%); numbers in tables get
  `font-variant-numeric: tabular-nums`. **Exception — outlined/stroked display type**
  (`-webkit-text-stroke`, hollow letters): tracking ≥ 0, always. The stroke adds weight
  OUTWARD, so glyphs collide at spacings that look fine filled — touching letterforms read as
  broken, not bold (observed live: −3% on 150px hollow caps overlapped and the user called it
  out on sight). Check adjacent pairs at the final rendered size, per weight and per style.
- **Never** fake bold/italic (synthesized when the weight isn't loaded), never more than 2 families
  (a variable family with real range often beats a pairing), never justify text on the web.

## Spacing & layout

- **One base unit** (4px or 8px) and a scale of multiples (4, 8, 12, 16, 24, 32, 48, 64…). Every
  gap, padding and margin comes from the scale — `scripts/scale.mjs --space` checks this.
- **Proximity encodes meaning:** the gap between groups ≈ 2× the gap within a group. If spacing is
  uniform everywhere, grouping is invisible (Gestalt violation).
- **Grids:** 12-column fluid with consistent gutters for pages; a defined content max-width;
  alignment edges chosen once and kept — every "almost aligned" edge reads as a bug.
- **Optical over metric:** icons next to text, triangles in play buttons, and glyphs in circles
  need manual nudging to _look_ centered. Metric centering is the starting point, not the answer.
- **Normalize mixed-ratio media in a set.** Logos, avatars, thumbnails, icons or illustrations of
  different native aspect ratios dropped into one grid/row render at different visual sizes and
  off-centre — a real misalignment ("desfase") even when each item is individually fine. Fit each
  into an identical box scaled by its longest side (`object-fit: contain` for raster/`<img>`;
  a shared square `viewBox` + `preserveAspectRatio="xMidYMid meet"` for inline SVG — see
  `illustration.md` Step 4). Verify: rendered longest side equal across items, centre error ~0.

## Color

- **Work in OKLCH** (perceptual: equal L steps look equal; hue doesn't shift when you change
  lightness). CSS: `oklch(L C H)`; supported in all modern engines — verify only if targeting
  legacy.
- **Palette recipe:** one neutral ramp of 9–11 steps with a slight cast toward the brand hue
  (chroma 0.005–0.02 — pure gray reads as unfinished); one accent with a full ramp; 1–2 semantic
  hues (success/danger) tuned to match the accent's chroma level.
- **Proportion:** ~60% neutral surface, ~30% secondary/structure, ~10% accent. The accent is
  spent on the ONE primary action per view, not sprayed.
- **Dark mode is its own palette**, not an inversion: reduce chroma, lift blacks (surface ≈
  L 0.15–0.22), avoid pure white text (L ≈ 0.9), re-verify every contrast pair per theme.
- **Contrast is computed** — `scripts/contrast.mjs` takes hex and `oklch()` strings directly
  (flags gamut-clipped values), and `scripts/palette.mjs` generates whole ramps with the key
  pairs pre-checked; by hand if no shell. WCAG formula:
  relative luminance `L = 0.2126·R + 0.7152·G + 0.0722·B` where each channel is `c/12.92` if
  `c ≤ 0.04045` else `((c+0.055)/1.055)^2.4` (c = sRGB 0–1). Ratio = `(L₁+0.05)/(L₂+0.05)`.
  Gates: normal text ≥ 4.5:1 · large text (≥ 24px, or ≥ 18.66px bold) ≥ 3:1 · UI/meaningful
  non-text ≥ 3:1.
- **Never encode state by hue alone** — pair color with text, icon or shape.

## Depth & surface

- **One light source.** All shadows in a view share a direction. Layer two shadows (a tight key +
  a soft ambient) instead of one heavy blur.
- Shadows, hairline borders, and background-shifts are _alternative_ depth systems — the direction
  picks one primary; mixing all three at random reads as generated.
- Corner radius is a token with ≤ 3 values (e.g., 0/4/8), applied by element class — not a
  per-component guess. Nested radii: inner = outer − padding (or concentric corners look broken).

## Motion

- **Durations:** micro-feedback 100–150ms · small transitions 150–250ms · large/spatial 250–400ms.
  UI motion above 500ms is almost always too slow.
- **Easing:** enter = decelerate (`cubic-bezier(0, 0, 0.2, 1)`) · exit = accelerate
  (`cubic-bezier(0.4, 0, 1, 1)`) · move = standard (`cubic-bezier(0.4, 0, 0.2, 1)`). Springs for
  playful directions (use a real spring API, not a bounce keyframe).
- **Animate only `transform` and `opacity`** where possible (compositor-friendly); never animate
  layout properties in lists.
- **Motion must explain** (where something came from, where it went, what changed) — decorative
  motion is spent from the novelty budget, sparingly.
- **`prefers-reduced-motion` is mandatory:** decorative motion drops to none; essential motion
  becomes a non-moving change (fade/instant).

## Accessibility gate (summary — the full gate is vkm-discipline `domains/design-ui.md`)

Non-negotiable in every direction, every medium: computed contrast per theme · complete
keyboard-only flow with visible focus · touch/click targets ≥ 24×24px CSS (44 on touch) · the
three screen states designed (empty / error / loading) plus control states
(hover/focus/disabled/busy) · holds at the declared minimum width and at 200% zoom · no
information by color alone.
