# Lineages — executable recipes, not style names

`direction.md` names the lineages; this file makes each one buildable. A capsule is a starting
position, not a costume: commit to one, derive your tokens from it, then let the brief pull it
somewhere specific. Typeface names are real and free (Google Fonts / Fontshare) unless marked —
availability and current version are verified online at use-time like any library. Color values
are seeds: run them through `scripts/palette.mjs` / `scripts/contrast.mjs` before shipping.

## Contents

- Swiss / International
- Editorial print
- Bauhaus / geometric
- Brutalist / raw
- Humanist minimal
- Terminal / instrument
- Art deco / ornament with geometry
- Retro-digital
- Naturalist / field guide
- Heritage / workwear
- Y2K chrome
- Groovy 70s
- Sci-fi HUD
- Scandinavian folk
- Collage / zine
- Soft dimensional / clay
- Using a capsule

## Swiss / International

- **Essence:** objective clarity; the grid is visible in the result even when no line is drawn.
- **Type:** one grotesk with real range — Archivo (incl. Expanded), Hanken Grotesk, or
  Schibsted Grotesk; Inter is _allowed here_ (this is the lineage that justifies it). Display
  tight (−2%), generous size jumps (ratio ≥ 1.333).
- **Color:** paper `oklch(0.97 0.005 90)`, ink `oklch(0.22 0.01 270)`, ONE signal
  `oklch(0.55 0.2 25)`. Nothing else.
- **Space/shape:** strict modular grid, hard alignment, radius 0–2px, no shadows — hairlines
  `oklch(0.85 0.005 90)` do all separation. Asymmetric layouts, deliberate empty columns.
- **Motion:** mechanical — 150ms, standard easing, no springs.
- **Precedent:** Josef Müller-Brockmann posters; Braun product sheets.
- **Fails when:** everything is centered — Swiss asymmetry is the point.

## Editorial print

- **Essence:** the page is a magazine spread; type contrast IS the design.
- **Type:** serif display with personality — Fraunces (variable optical size) or
  Instrument Serif — over a quiet text face (Newsreader, Source Serif 4). Big drops between
  display and body (ratio 1.414+), real italics, pull-quotes, small-caps labels.
- **Color:** warm paper `oklch(0.96 0.01 85)`, near-black ink `oklch(0.2 0.02 60)`, one
  accent used like a highlighter pen `oklch(0.6 0.16 40)`.
- **Space/shape:** columns with a real measure (60–70ch), rules between sections, drop caps if
  earned; radius small; images duotone or full-bleed.
- **Motion:** slow reveals on scroll only if they aid reading; otherwise none.
- **Precedent:** well-set books; feature spreads in serious magazines.
- **Fails when:** used for dense interactive UI — it's for reading surfaces.

## Bauhaus / geometric

- **Essence:** form from primary geometry; playful but constructed.
- **Type:** a geometric sans with character — Bricolage Grotesque, Clash Display (Fontshare),
  or Josefin Sans for display; pair with a plain grotesk body.
- **Color:** near-white field + primaries tuned, not crayon: red `oklch(0.55 0.2 25)`, blue
  `oklch(0.5 0.16 260)`, yellow `oklch(0.85 0.16 95)`, black. Use 2 of the 3, not all.
- **Space/shape:** circles/squares/triangles as real layout elements; thick rules; radius either
  0 or full-round, never mid.
- **Motion:** geometric — things rotate/slide on axes, springy is acceptable.
- **Precedent:** Bauhaus posters; contemporary editorial sites that block-build layouts.
- **Fails when:** the geometry decorates instead of structures.

## Brutalist / raw

- **Essence:** structure exposed, defaults embraced, zero smoothing.
- **Type:** system stack or a plain mono (IBM Plex Mono, Space Mono); oversized headings set
  flush left; underlines are real underlines.
- **Color:** white/black plus ONE unmixed loud hue `oklch(0.65 0.25 140)` or a pure link-blue;
  backgrounds may be the accent itself.
- **Space/shape:** visible borders (1–2px solid) everywhere, no radius, no shadows, dense;
  default scrollbars and focus rings kept.
- **Motion:** none, or instant state swaps.
- **Precedent:** early-web utility pages done on purpose; Craigslist-adjacent honesty.
- **Fails when:** rawness excuses broken hierarchy — brutalism is still composed.

## Humanist minimal

- **Essence:** quiet warmth; the design recedes, the content feels cared for.
- **Type:** humanist sans — Karla, Alegreya Sans, or General Sans (Fontshare) — with a serif
  option for long text (Alegreya, Newsreader). Modest ratio (1.2–1.25), roomy line-height.
- **Color:** warm neutrals via `palette.mjs --hue 85 --chroma 0.06`-style seeds; surfaces barely
  distinct `oklch(0.98/0.955/0.93 0.008 85)`; one muted accent `oklch(0.55 0.1 150)`.
- **Space/shape:** generous padding (space scale ×1.5 vs dense), radius 6–8px consistent,
  depth via surface shifts not shadows.
- **Motion:** soft — 200–250ms decelerate, fades over slides.
- **Precedent:** MUJI print; quality reading apps.
- **Fails when:** low contrast masquerades as calm — compute the pairs; calm still passes AA.

## Terminal / instrument

- **Essence:** an instrument for operators: density, signal colors, zero ornament.
- **Type:** mono for data — JetBrains Mono, IBM Plex Mono, or Commit Mono — grotesk for chrome;
  small sizes, tight ratio (1.125–1.2), `tabular-nums` non-negotiable.
- **Color:** near-black field `oklch(0.15 0.015 250)`, high-L text `oklch(0.87 0.02 250)`,
  semantic signals only: green/amber/red at matched chroma (`palette.mjs --hue 145` etc.).
  Light theme = paper instrument: `oklch(0.97 0.005 250)` + ink.
- **Space/shape:** 4px base unit, radius 0–2px, hairline dividers, columns aligned to the
  character grid; status shown as symbol + color, never color alone.
- **Motion:** instant; blinking is banned; a 120ms fade on data refresh at most.
- **Precedent:** trading terminals, cockpit displays, htop done well.
- **Fails when:** density without hierarchy — an instrument still has ONE primary readout.

## Art deco / ornament with geometry

- **Essence:** luxury through constructed ornament — frames, fans, stepped forms.
- **Type:** high-contrast display — Marcellus, Cormorant, or a deco-flavored geometric
  (Josefin Sans, Limelight for pure display) — over a restrained sans body; generous tracking
  (+5–8%) on caps display.
- **Color:** deep field `oklch(0.25 0.04 280)` or `oklch(0.3 0.05 160)`, metallic accent faked
  honestly with a two-stop gold ramp `oklch(0.78 0.12 85)→oklch(0.62 0.1 80)`, cream text
  `oklch(0.93 0.02 90)`.
- **Space/shape:** symmetric compositions, stepped/chamfered corners, thin double rules and
  frame borders as the texture.
- **Motion:** cinematic and sparse — one elegant entrance, then stillness.
- **Precedent:** deco book covers, hotel identities, Gatsby-era posters.
- **Fails when:** ornament is sprayed instead of framed — deco ornament always encloses.

## Retro-digital

- **Essence:** a deliberate era quote — early OS chrome, pixel type, CRT phosphor.
- **Type:** Departure Mono or Silkscreen for accents/labels (pixel faces are display faces —
  body text stays a readable mono/sans); DotGothic16 for a softer pixel voice.
- **Color:** pick ONE era: phosphor mono (`oklch(0.8 0.16 145)` on `oklch(0.14 0.01 145)`),
  1-bit paper (pure black on `oklch(0.97 0 0)` + dither patterns), or 90s-OS gray
  (`oklch(0.85 0.005 270)` chrome + navy title bars).
- **Space/shape:** hard pixels — radius 0, borders bevel-style (light top/left, dark
  bottom/right) if OS-era; scanline/dither textures at low opacity if CRT-era.
- **Motion:** stepped (`steps()` easing), not smooth — smoothness breaks the quote.
- **Precedent:** System 7 / Win95 chrome; terminal phosphor; teletext.
- **Fails when:** the quote is only skin-deep — commit in cursors, focus styles and sounds-off
  details, and keep real accessibility (the era's contrast sins don't get quoted).

## Naturalist / field guide

- **Essence:** the page is a specimen plate — knowledge presented with collector's care.
- **Type:** literary serif for text (Newsreader, Source Serif 4), display serif with character
  (Fraunces), mono or hand-annotation accents (Space Mono; Caveat for margin notes, sparingly).
- **Color:** cream paper `oklch(0.96 0.015 85)`, deep forest `oklch(0.35 0.08 150)`, river blue
  `oklch(0.45 0.09 230)`, rust stamp `oklch(0.55 0.14 35)`.
- **Space/shape:** plates with fine borders + plate numbers, captions in small caps, ruled
  tables like a logbook; radius 0–4px; texture via fine line motifs (contours, waves) not photos.
- **Motion:** none or paper-quiet fades.
- **Precedent:** Audubon plates, vintage field guides, natural-history museum labels.
- **Fails when:** it turns twee — the science look needs real information density to earn it.

## Heritage / workwear

- **Essence:** Americana trade goods — built to last, stamped and labeled.
- **Type:** slab or condensed sans for display (Archivo Black, Bebas Neue; slab: Zilla Slab),
  sturdy text sans; badge lockups in caps with +6% tracking.
- **Color:** oxblood `oklch(0.42 0.13 25)`, navy `oklch(0.32 0.07 250)`, tan `oklch(0.75 0.06 75)`,
  unbleached paper `oklch(0.94 0.015 80)`.
- **Space/shape:** badges/roundels, thick-thin border pairs, letterpress-style offset shadows
  (solid, 2–4px, no blur), stitched dividers (dashed borders).
- **Motion:** stamp-like: instant or 120ms steps.
- **Precedent:** tool catalogs, heritage denim branding, national-park posters.
- **Fails when:** badge soup — one badge is identity, five are clutter.

## Y2K chrome

- **Essence:** the optimistic gloss of 1999–2003 — chrome, aqua, plastic transparency.
- **Type:** rounded or techno geometric (Bungee, Audiowide, Rubik variants); chrome text via
  layered gradients reserved for ONE display moment.
- **Color:** silver ramps `oklch(0.85→0.6 0.01 250)`, aqua `oklch(0.8 0.13 210)`, hot accents
  (magenta 350 / lime 130); glossy highlights as hard white curves, not soft glows.
- **Space/shape:** pill buttons with specular highlight, orbs, brushed-metal panels; radius large
  but PAID (this lineage justifies it — write the line).
- **Motion:** bouncy, springy, unashamed.
- **Precedent:** iMac G3 era ads, early winamp/OS skins, Y2K revival editorial.
- **Fails when:** it collapses into glassmorphism — Y2K gloss is OPAQUE plastic and chrome,
  not blurred translucency.

## Groovy 70s

- **Essence:** warm psychedelia — sunset ramps, round shoulders, type that flows.
- **Type:** chunky rounded display (Lilita One, Sigmar, Bungee) or a swashy serif (Fraunces
  WONK cranked); generous, curvy.
- **Color:** ochre `oklch(0.72 0.13 75)`, burnt orange `oklch(0.6 0.16 45)`, avocado
  `oklch(0.6 0.11 120)`, chocolate `oklch(0.35 0.06 60)` on warm cream — the whole palette from
  one sunset, hues 40–130 only.
- **Space/shape:** arches and half-circles as layout containers, stripes in palette order
  (the rainbow-arc motif), rounded everything — coherently.
- **Motion:** slow, wavy, sine-eased.
- **Precedent:** 70s record sleeves, vintage travel posters, groovy revival branding.
- **Fails when:** hue discipline breaks — add a cool blue and the sunset dies.

## Sci-fi HUD

- **Essence:** a heads-up display — information floating on glass, but LINES not blur.
- **Type:** extended/techno sans for labels (Orbitron, Aldrich, Major Mono Display), mono for
  data; wide tracking on tiny caps labels (+10%).
- **Color:** deep space `oklch(0.15 0.03 250)`, holo cyan `oklch(0.8 0.13 210)`, alert amber
  `oklch(0.75 0.14 80)`; ONE hue family for chrome, semantic colors only for status.
- **Space/shape:** corner brackets `⌐ ¬` on panels, 1px lines with node dots, radar/reticle
  motifs (SVG), scanline texture at 2–3%; radius 0–2px.
- **Motion:** instrument sweeps, 150ms; data ticks; never bouncy.
- **Precedent:** cockpit HUDs, sci-fi film UI (careful: homage, not prop clutter).
- **Fails when:** decoration outruns data — a HUD with fake numbers is a costume.

## Scandinavian folk

- **Essence:** craft geometry — paper-cut motifs, warm restraint, folk pattern used sparingly.
- **Type:** humanist sans (Hanken Grotesk, Karla) + a display with slight quirk (Bricolage);
  never cold geometry.
- **Color:** wool white `oklch(0.96 0.01 90)`, falu red `oklch(0.45 0.13 30)`, pine
  `oklch(0.4 0.07 160)`, sky `oklch(0.75 0.06 240)`.
- **Space/shape:** symmetric folk borders (repeating SVG stamps) framing ONE section, generous
  whitespace elsewhere; radius small; woodcut-like icons.
- **Motion:** gentle, 200ms fades.
- **Precedent:** Marimekko-adjacent print, Nordic packaging, folk embroidery bands.
- **Fails when:** pattern everywhere — folk borders frame, they don't wallpaper.

## Collage / zine

- **Essence:** cut-and-paste urgency — tape, torn edges, clashing type ON PURPOSE.
- **Type:** mix 2–3 voices deliberately (a serif clipping + a mono + marker scrawl — Permanent
  Marker/Caveat); ransom-note emphasis for single words, not sentences.
- **Color:** photocopier black/white base + 1–2 fluoro spot colors `oklch(0.85 0.2 130)` /
  `oklch(0.7 0.22 350)`.
- **Space/shape:** rotated scraps (±2–4°), tape strips (semi-opaque rectangles), torn edges
  (clip-path polygons), overlapping stacks; hard shadows.
- **Motion:** stop-motion steps(2–3), or none.
- **Precedent:** punk zines, gig posters, contemporary zine-revival editorial.
- **Fails when:** chaos without a grid underneath — collage reads only against hidden order.

## Soft dimensional / clay

- **Essence:** touchable depth — pastel plastic you want to press.
- **Type:** rounded friendly display (Fredoka, Baloo-likes) + clean body; chunky weights.
- **Color:** pastel surfaces (L 0.9+, C 0.04–0.07) with 2–3 saturated pops; shadows are
  same-hue darker, NEVER gray (`0 6px 0 <hue L−0.08>` + soft same-hue blur).
- **Space/shape:** large radii (paid: this lineage IS the radius), extruded buttons that
  physically depress on :active (translate + shadow shrink), floating tilted cards.
- **Motion:** squash-and-stretch hints, springy hover lifts.
- **Precedent:** claymorphism app showcases, toy packaging, run-5A "Sugar Rush".
- **Fails when:** contrast dies in the pastel fog — compute the pairs; candy still passes AA.

## Using a capsule

1. Pick per `direction.md` (the capsule is the "lineage/era" axis made concrete).
2. Copy its seeds into the token layer, then run `palette.mjs`/`contrast.mjs`/`scale.mjs` —
   seeds are starting points, gates are gates.
3. Deviate deliberately: change ONE thing the capsule prescribes and name why (that deviation
   is usually where the signature lives).
4. Cross with one contemporary current (`contemporary.md`, this folder): the capsule is
   the language, the current is the move — a capsule executed with zero moves ships a museum
   piece, not a page someone remembers.
