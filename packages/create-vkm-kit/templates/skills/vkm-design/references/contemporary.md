# Contemporary currents — what award-level work is doing right now

> **Time-stamped knowledge** (last verified online: 2026-07). Principles in `foundations.md` age
> in decades; currents age in seasons. If this file is more than ~6 months old and you have web
> access, spot-check a current before leaning on it (award galleries, foundry releases, trend
> round-ups). Sourced from cross-checked 2026 award/trend coverage, not from model memory.

**Why this file exists:** passing every gate produces a _correct_ page; correct is the floor.
Award-level work adds one or two **moves** — deliberate, high-intensity compositional decisions —
on top of a quiet, gate-passing system. This file is the menu of moves that are alive right now,
each with an executable recipe and its slop-version to avoid.

## The boldness budget (rule, not vibe)

Every new surface gets **1–2 moves at full intensity, everything else stays quiet**. Zero moves =
template (the failure the user notices even when all gates pass). Three+ moves = noise. The move
must be derivable from the direction, and it must live **in the first viewport** or the first
interaction — that is where the lineup test is decided.

**Lineup test (run it every time):** render the first viewport, hide the logo, put it next to ten
template screenshots in your head. If nothing lets you pick it out, the assignment is failed
regardless of the gates. Name the element that makes it yours; if you can't, add the move.

## The moves — recipes and their slop versions

### 1. Typographic statement

The headline IS the layout: display type at `clamp(3.5rem, 12vw, 11rem)`, leading 0.9–1.0,
tracking −2…−4%, spanning 90%+ of the measure. Mix one axis hard: weight (100 vs 900 in one
line), width (condensed vs wide), or fill vs outline (`-webkit-text-stroke: 1.5px` on one word).
Free faces with real range: Fraunces (WONK/SOFT axes), Bricolage Grotesque, Anton / Archivo
Black (brutalist condensed), Big Shoulders, Recursive (CASUAL axis).
**Slop version:** big Inter Bold centered with a gradient fill.

### 2. Exposed structure

Show the grid instead of hiding it: hairline column rules (`repeating-linear-gradient` or
bordered columns) running full height, content visibly snapped to them; section numbers (01, 02)
set huge and half-cropped; baseline-grid feel. Reads as confidence and craft.
**Slop version:** decorative lines unrelated to where anything actually aligns.

### 3. Color-field flips

Alternate full-bleed sections that INVERT the palette (paper → ink → one accent field at full
saturation), with hard edges, no gradients between. One high-chroma "flash" element (a thick
rule, an oversized numeral, a marquee strip) cutting through a quiet layout. Build accents in
OKLCH away from the indigo default: electric lime (~130), signal orange (~50), cobalt (~250 at
high C), hot pink (~350) — one hue only, huge doses of neutral around it.
**Slop version:** the dopamine palette applied to everything at once; or indigo again.

### 4. Editorial overlap

Elements that share space: type overlapping an image/graphic block (grid areas that intersect,
negative margins), a rotated stamp/sticker breaking a column edge, captions in the gutter. Depth
by stacking order and offset, not by drop shadows.
**Slop version:** random rotation on cards; overlap that collides at other viewport widths
(verify at the narrow width — overlap must be designed per breakpoint, not accidental).

### 5. Marquee strip

One infinite horizontal strip (clients, keywords, a repeated promise) as a kinetic texture:
CSS-only `@keyframes` translateX loop on a duplicated track, `animation-play-state: paused` on
hover and disabled under `prefers-reduced-motion` (show the static row instead).
**Slop version:** two or more marquees per page, or a marquee carrying content users must read.

### 6. Scroll narrative

`position: sticky` panels that hold while content passes; staged reveals via scroll-driven
animations (`animation-timeline: view()` inside `@supports`, with a no-animation fallback);
optionally one horizontal `scroll-snap` strip for a gallery. Motion must explain sequence, not
decorate.
**Slop version:** fade-up-on-scroll applied to every element equally (that's the template move).

### 7. Cinematic block + grain

A full-bleed scene as the hero or a mid-page beat: layered CSS gradients as light, an SVG
`feTurbulence` noise overlay as data-URI at 3–6% opacity (kills the flat-AI-gradient look), type
set INTO the scene (not floating on a card above it). Works fully offline/single-file.
**Slop version:** stock-photo hero with a white card floating on top; noise at 20% everywhere.

### 8. Micro-interactions that move

Hover/focus states with real displacement: underline that grows from one side, arrow that
travels, a block-fill that slides in behind the label — 120–200ms, `transform`/`opacity` only,
visible focus ring kept. One interaction language repeated consistently across the page.
**Slop version:** scale(1.05) + shadow on every card.

### 9. Retro-digital quote

A deliberate era accent inside a modern layout: mono labels (JetBrains/Space/Fragment Mono),
pixel accents (Silkscreen, VT323) for tags or numerals, terminal-style status lines. One era,
one role — an accent voice, never the body.
**Slop version:** the whole page in pixel font; mixing three eras.

### 10. Immersive/3D touch (declare the budget)

Award galleries are currently dominated by immersive 3D — but real 3D needs WebGL and a JS
budget. In a single-file/no-JS deliverable, fake depth honestly: layered parallax via
`transform: translateZ`/perspective on scroll-driven timelines, oversized cropped shapes,
stacked planes. If the brief wants true 3D, name the dependency (three.js et al., verify
current) instead of shipping a broken imitation.
**Slop version:** a tilted screenshot with a huge shadow calling itself "3D".

### 11. Image treatment as identity

Photos never raw: pick ONE treatment and apply it everywhere — duotone (two brand hues via
`filter: grayscale(1)` + a multiply/screen overlay), halftone (radial-gradient dot matrix
overlay), riso grain, or hard-crop into geometric frames. One treatment = a system; per-photo
whims = a scrapbook. Works with zero photos too: CSS/SVG scenes take the same treatment.
**Slop version:** untreated stock photos with white cards floating on top.

### 12. Sticker & badge layer

A system of 3–5 stamped elements (pill stickers with hard borders, roundel badges, price
burst) rotated ±2–6°, reused consistently as the page's annotation voice. Pairs naturally
with dopamine, zine and heritage lineages.
**Slop version:** one lonely "✨ New" pill centered over the hero — that's the fingerprint.

### 13. Giant cropped wordmark

The brand name at 15–25vw set at the page foot (or hero edge), deliberately cropped by the
viewport (`line-height < 1`, negative margin), low-contrast against its field — architecture,
not navigation. One per page.
**Slop version:** cropping so aggressive the name is unreadable AND repeated in every section.

### 14. Custom cursor & selection

The cheapest full-page signature: `::selection` in the accent pair, plus (desktop-width media
query only) a custom SVG cursor or a dot-follows-cursor element for interactive zones. Never
hide the native cursor on text or forms; skip entirely under `prefers-reduced-motion` when it
animates.
**Slop version:** a laggy JS blob chasing the pointer over the whole page, forms included.

## Where this plugs in

- `direction.md`: a direction = lineage capsule × **one contemporary current** — the cross is
  usually the signature. Pick the current DURING direction, not as decoration after.
- `modes/generate.md` step 5: implement the chosen move(s) as part of the build, tokens first.
- `modes/critique.md`: "no memorable move in the first viewport" is a **Major** finding — cite
  which move would fix it.
- `modes/visual-loop.md`: the lineup test runs on the first-viewport screenshot every iteration.
