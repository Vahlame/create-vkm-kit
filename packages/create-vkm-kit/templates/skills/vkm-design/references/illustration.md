# Bespoke illustration — the thinking, and the faithful method

Load this whenever a deliverable includes a **figurative depiction of a real thing** you author:
a species, an animal mascot, a product, a landmark, a portrait, a tool, custom iconography of
anything that exists. This is the single place a model most reliably ships something confidently
wrong, and where "draw an SVG" is usually the WRONG first move.

## The failure, and its root cause (real, from this kit's own bench)

Asked for a **guapote** (a deep-bodied cichlid) on a fishing page, the model hand-wrote SVG bézier
coordinates from memory. Out came a streamlined body, a forked tail, dorsal finlets — **a tuna**.
Every design gate passed. It was still wrong, and the root cause is not "tried but missed":

> **Hand-plotting bézier coordinates from imagination cannot produce a faithful drawing of a
> complex real subject.** You are sampling the category average stored in your weights, and
> emitting it as coordinates you cannot see. The result looks like "a fish", never like _that_
> fish. No amount of care in the path data fixes a silhouette that was guessed.

So the fix is not "draw more carefully". It is **stop hand-plotting, and pick the right tool.**

## Step 1 — think: what makes this subject recognizable, and which technique fits?

Before any code, answer two questions.

**(a) What is the recognizable essence?** Name the 3–6 features that make this subject not a
generic member of its class — the things an expert would check. (Guapote: deep oval body ~2.3×
long-to-tall, one long dorsal, **rounded** tail, big terminal mouth.) This is your spec and your
acceptance test, whatever technique you use.

**(b) Match the technique to the subject × the wanted look.** This decision is the whole game:

| Situation                                                                                                               | Right technique                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Faithful depiction of a **complex real subject** with a **clean line-traceable reference** (silhouette, plain-bg photo) | **Trace** → `scripts/trace-svg.mjs` (potrace). Clean crisp line-art / silhouette.                                                                                                                                                                                   |
| Faithful depiction where NO clean reference exists (**fine texture, busy background, a portrait**)                      | **Treat the real photo** → `scripts/treat-photo.mjs` (duotone / halftone / cutout). It IS the photo, so it's faithful with full detail; the treatment makes it one system. `--cutout` removes a plain background; a busy background can't be auto-cut (see Step 2). |
| A **generic symbol** (settings gear, cart, arrow, social icon)                                                          | Use a real **icon library** (`libraries.md`) — don't redraw a solved glyph.                                                                                                                                                                                         |
| A **simple / geometric / deliberately abstract** mark                                                                   | Hand-draw SVG is fine — the shape is invented, not observed (see `marks.md`).                                                                                                                                                                                       |
| A **brand mark OF a real thing** (a bird for a birding app)                                                             | Trace/observe first for a faithful base, THEN apply mark craft (`marks.md`).                                                                                                                                                                                        |

The tell: if you're about to type bézier coordinates for something you'd need a photo to draw
accurately, you picked the wrong technique. Go back to the table.

## Step 2 — the faithful trace pipeline (`scripts/trace-svg.mjs`)

Node ≥ 18, needs `potrace` + `jimp` + `svg-path-bbox` (`npm i potrace jimp@0.22 svg-path-bbox` in
a scratch dir — these aren't bundled, since most design tasks don't trace; installing takes
seconds). Reference photo/silhouette → subject mask (Otsu threshold, alpha-aware for transparent
PNGs) → potrace vector → restyled line-art or filled silhouette.

```text
node trace-svg.mjs <ref.(jpg|png)> <out.svg> [--stroke "#1b3a2b"] [--fill none|<color>]
     [--bg auto|light|dark] [--threshold N] [--turd 80] [--w 440] [--square]
```

Pass **`--square`** when the trace will sit in a grid/row with others: it crops to the tight
content bbox and centres it in a padded square viewBox, so every specimen renders same-sized and
aligned regardless of native aspect ratio (Step 4). Without it you inherit potrace's full-image
viewBox and the misalignment below.

**Clean the mask, or you trace the noise.** A raw threshold of a photo carries background specks
and interior texture; tracing that directly produces the speckled, artifact-ridden look ("stuck
to the photo with excess"). `trace-svg.mjs` cleans by default — keeps the **largest connected
component** (drops background blobs and floating specks), **fills interior holes** (kills the
speckle), and **morphologically smooths** the outline — so the trace follows the SHAPE, not the
grain. A clean specimen traces to ONE path; a noisy one to dozens (a fast tell). `--raw` disables
cleaning.

Two honest limits, both of which the verify gate below catches:

- **Cleaning needs a separable subject.** On a busy background the threshold can't tell subject
  from scene, and "largest component" may lock onto the wrong blob. You cannot threshold a fish
  out of a cluttered aquarium — get a plain-background reference or isolate it first.
- **Fill-holes fills _every_ enclosed gap** — great for speckle, wrong for subjects whose holes
  are meaningful (scissor handles, a bicycle's frame triangles, the gaps between an octopus's
  arms). For those, use `--raw` with a clean reference, or accept a solid silhouette.

Best references, in order: a clean **silhouette / line drawing on white** (PhyloPic CC0 for
organisms; PD engravings) traces near-perfectly; a **plain-background product photo** traces well;
a busy photo does not — don't force it. Then stylize the traced paths to the direction — keep as a
filled specimen silhouette, or `fill:none` for line-art, recolor, add a few deliberate interior
detail strokes (eye, gill) if the look wants them — added by hand, never inherited from noise.

## Step 2b — treat the photo (`scripts/treat-photo.mjs`) when you can't trace it

Some faithful subjects have no clean line to trace — a speckled trout, a portrait, anything whose
character lives in texture. Don't force a trace (you get noise). **Style the real photo instead**,
so it stays faithful (full detail, it IS the subject) but reads as one designed system:

```text
node treat-photo.mjs <in.(jpg|png)> <out.png> --mode duotone|halftone|cutout
     [--shadow "#14210f"] [--highlight "#eef0e0"] [--cutout] [--field none|<hex>] [--w 900] [--dot 6]
```

- **duotone** — map luminance to a two-colour ramp (the shadow/highlight of your palette). The
  cleanest, most legible, most versatile treatment; a speckled trout or a veined leaf becomes a
  crisp field-guide plate. Reach for this first.
- **dither** — a **blue-noise ordered dither** (void-and-cluster threshold matrix, Ulichney 1993):
  a high-frequency, cluster-free stipple that reads like a fine engraving / laser plate. This is
  the **polished** stipple — reach for it over `halftone` unless you specifically want the visible
  regular-grid look. Smooth tonal gradation, no muddy mid-tones, no directional banding.
- **halftone** — a dot matrix on a regular grid sized by darkness (overt print texture); a
  retro/editorial voice. Legible only with the two built-in aids below; `dither` is cleaner.
- **cutout** — keep the subject, drop the background (`--field` sets a flat backdrop, else
  transparent). **Meticulous by construction:** it isolates the subject by morphological
  **opening** (`--isolate N`, erode → keep largest → dilate) so thin-bridged satellites — other
  leaves on a branch, stray specks — fall away and only the main compact subject survives, then
  **auto-trims to the subject's exact bbox** (+ tiny `--pad`) so the asset carries no dead margin
  and drops into ANY container at any size, like a proper die-cut sticker. But isolation only
  breaks THIN bridges: a reference where the subject is genuinely separate (a single leaf on
  white) cuts out flawlessly; a cluster fused at thick bases (a whole branch) can't be auto-split
  — get a single-subject reference. A busy scene can't be auto-cut at all (same limit as tracing).

**Legibility is engineered, not hoped for** (both built in): the tool **contrast-stretches**
luminance to the 2nd–98th percentile so a mid-gray subject uses the full tonal range instead of
muddy mid-tones, and on a cutout it draws a **crisp silhouette outline** so the shape reads at a
glance even through halftone dots. Finer `--dot` = more detail. But the biggest lever is the
**reference**: a clear, well-lit, side-on shot treats beautifully (trout, leaf, fedora all read
instantly); an odd-angle or reflective photo (a teapot shot on its side with highlights) reads as
a blob no matter the settings — **if the eye can't tell what it is, the reference was wrong, not
the treatment.** Verify the only way that counts: render the PNG and LOOK at it (raster views
render reliably even where SVG screenshots don't).

**Quality is preprocessing + resolution, not the mode.** A flat, low-res treatment looks amateur;
the difference to "incredible" is a preprocessing stack borrowed from laser-engraving practice,
built into every mode (bundled by `--preset photo|detail|portrait|dramatic|flat`, or override with
flags): **`--sharpen`** (unsharp mask — the biggest lever; detail bites), **`--scurve`** (opens
midtones, deepens shadows for photoreal punch), **`--clarity`** (local contrast), on top of the
auto contrast-stretch. And **render big**: the treatment's "DPI" is its pixel resolution — a photo
downsized to 700 px gives coarse dots, the SAME photo at `--w 1400` gives a fine engraving. Render
at ≥ 2× the display size (retina) and let the browser scale it down. A high-res `dramatic`-preset
dither of a mountain reads like a museum steel engraving; the low-res default reads like a filter.

**Detail needs a subject with internal contrast, not just resolution.** A uniformly light or dark
subject (a golden retriever in side profile) engraves as a featureless blob — there's no tonal
variation to resolve, so no fur, no eyes, no separation. Choose a reference with **internal
contrast and a clear face** (eyes/nose are dark anchors that read instantly), then push `--clarity`
and `--sharpen` to separate regions. On this kit's bench, swapping the flat golden-retriever
profile for a higher-res Labrador with a visible face — at `--preset dramatic` — turned a blob into
a portrait where the face, collar, legs and coat all differentiate.

**Two standing rules.** (1) **When you DO treat as a stipple/engraving, max it out** — highest
source resolution, best preset, full preprocessing; a semitono is only worth doing at maximum
detail and DPI, never half-resolved. (2) **But never marry one technique.** `dither` is one tool,
not the default look. Be resourceful across the whole toolbox and pick what serves the CONTENT and
the direction best — a clean high-res web photo used as-is, a duotone, a full-colour image, a
cutout die-cut, a traced silhouette, a hand-drawn stylization — and then **bring it to life**:
animate it with a real library (GSAP/ScrollTrigger for scroll reveals and timelines, three.js for
3D/WebGL, Lottie/anime.js for micro-motion — verify the current version online, embed it), or with
CSS scroll-driven animation + `prefers-reduced-motion`. Source content resourcefully (CC/CC0 photo
libraries, PhyloPic, PD scans). Always render-and-look before committing.

Needs only `jimp`. Output is a PNG you embed (data-URI for a single-file page). This is the
faithful path for exactly the subjects that made hand-plotting and forced tracing fail.

## Step 3 — verify by overlay (the objective fidelity gate)

Faithfulness is measured, not eyeballed: rasterize the trace and the reference's subject mask to
the same size and compute **IoU** (intersection ÷ union). On this kit's bench, traced specimens
scored **0.66–0.92** (tuna 0.92, trout 0.90, teapot 0.92, bee 0.85, tarpon 0.80, machaca 0.68,
bicycle 0.66) — versus hand-plotted beziers, which share no geometry with the real subject at all.

Rule of thumb: **ship ≥ ~0.7; below that, DROP the specimen** — get a cleaner reference or leave it
out, never ship the artifact. On this kit's Cabinet the gate did exactly that: the busy-background
aquarium fish and the holed objects (scissors, trumpet) fell below threshold and were dropped, so
the published sheet shows only faithful, clean specimens (0.64–0.98) instead of a wall of noise.
A thin-structured subject (a bicycle) scores lower by nature — judge it partly by whether its
recognizable features survived. Always finish with the feature check from Step 1: would an expert
name the subject correctly?

## Step 4 — placing several illustrations together (alignment / "desfase")

A specimen grid, icon row, or logo wall of bespoke art has a failure the drawings themselves
don't reveal: **each vector keeps its own native aspect ratio and its own framing, so dropped
into cards they render at different visual sizes and off-centre — a visible misalignment
("desfase") even when every drawing is individually correct.** A tracer makes this worse: potrace
emits the FULL image as the viewBox, so a subject that sat in a corner of its photo stays in the
corner of its box.

Fix it at the layout level, in two moves (measured, not eyeballed):

1. **Crop each art to its tight content bbox** — `getBBox()` on the path union (in a browser, or
   any SVG lib), then rewrite `viewBox` to that bbox plus even padding. This removes the empty
   margins that push subjects off-centre. (`trace-svg.mjs --square` does exactly this at trace
   time, via `svg-path-bbox`.)
2. **Reframe into ONE shared square** and let `preserveAspectRatio="xMidYMid meet"` scale each by
   its longest side, inside identical fixed cells. Now every subject occupies the same footprint,
   centred, regardless of a 1.4 vs 3.7 aspect ratio.

Verify objectively: the rendered longest side should be identical across items and the
content-centre-vs-cell-centre error ~0 (on the kit's Cabinet, after this fix: longest side a
uniform 172 px across all 7, centring error 0 px — before it, silhouettes ranged 46–126 px tall
and floated). This is a **layout** fix, not a library swap — SVG is the right medium; Three.js or
a different lib would inherit the exact same aspect-ratio problem. The same normalization applies
to any set of mixed-ratio marks (icon sets, partner logos, avatars).

## Legal & honest use of references

Use references for **facts** — anatomy, proportion, structure — which aren't protected; emit your
own line-work. Do NOT trace-and-ship a specific copyrighted illustration or a photographer's exact
image AS your output (that copies protected expression). Prefer public-domain / CC sources
(Wikimedia, PhyloPic CC0, old field guides); credit when the licence asks. A subject's factual
shape is fair to learn from; a particular photo's framing and retouch is not yours to take.

## Where this plugs in

- `modes/generate.md`: a bespoke figurative asset is planned in "system before screens" — pick the
  technique and fetch/trace the reference BEFORE building, never as a late detail pass.
- `modes/critique.md` / `modes/visual-loop.md`: **a figurative drawing that wasn't derived from a
  reference (or is visibly wrong for its subject) is a Major finding** — name the wrong feature and
  the technique that fixes it ("hand-plotted guapote has a forked tuna tail; trace a cichlid
  reference — the real tail is rounded").
- `examples/illustration-gallery.md`: the technique-matching table applied to eight different
  subjects end to end.
- `modes/critique.md`: a grid/row/wall of bespoke art rendering at inconsistent sizes or off-centre
  (the "desfase" of Step 4) is a finding — the fix is shared-square normalization, not redrawing.
- `references/marks.md`: for a logo OF a real thing, run this first, then apply mark craft to the
  faithful base.
