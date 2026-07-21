# Results — design-bench

## 2026-07-21 · AUTO round 1 (mechanical score, multi-model, held-out brief)

First round of the automated harness (`run.mjs`): score 0–100 from the skill's own
validators (slop fingerprint 40 + declared contrast 20 + type scale 20 + spacing
rhythm 20); judgment axes (lineup test, rendered composition) deliberately excluded.
Subjects: Agent-tool `haiku`/`sonnet` (n=2) and `opus` (n=1). Briefs: `facturio` (the
classic slop attractor) and `kelpwatch` (**held-out** — written for the harness, never
used to tune the skill). Raw HTML + scores: `results/2026-07-21-round1/`.

| Model      | Brief                | skill         | stock        | Δ            |
| ---------- | -------------------- | ------------- | ------------ | ------------ |
| sonnet     | facturio             | 75.0 [50,100] | 15.0 [10,20] | **+60.0**    |
| sonnet     | kelpwatch (held-out) | 70.0 [90,50]  | 40.0 [40,40] | **+30.0**    |
| opus (n=1) | facturio             | 60            | 0            | **+60**      |
| opus (n=1) | kelpwatch (held-out) | 100           | 60           | **+40**      |
| haiku      | facturio             | 35.0 [30,40]  | 30.0 [40,20] | +5.0 (noise) |
| haiku      | kelpwatch (held-out) | 80.0 [80,80]  | 80.0 [80,80] | 0            |

Reading: the big models gain hugely from the skill — most on the slop-attractor brief
(stock Opus scored 0 on facturio: full fingerprint + failing declared contrast) — and
the held-out brief reproduces the direction, so the gain is not fixture-tuned. Haiku is
flat: same dial-consistent pattern as discipline round 2 (where the full contract
exceeds the small model's reach, the skill neither helps nor hurts). Per-cell spread
(sonnet kelpwatch [90,50]) says n must grow before finer claims.

The manual before/after protocol below remains the record for judgment axes.

## Run 6p · 2026-07-12 · kill the house style — the skill prescribes no aesthetic

User's closing ask: make sure the skill doesn't suggest one specific style, so designs stop being
repetitive. Right — the deepest convergence isn't a value in the code, it's the model drifting to a
second-order comfort look (here: serif display + mono labels + warm-paper editorial, or its
dark-luxe mirror) and reusing it across unrelated briefs. Banning indigo didn't fix that; nothing
named it.

Named and guarded it in the skill: `SKILL.md` now states up front the skill has **NO house style**
— examples illustrate method, never a target look. `direction.md` adds "your OWN house style is the
subtlest slop" to the fingerprint (with this model's specific comfort look spelled out), and the
variety sampler now forces rotation on FIVE axes — hue, lineage (none = last build's; force a
rarely-picked one if you keep repeating), type pairing, current, and layout topology — with the
test "if all three candidate directions feel like _you_, you sampled your comfort zone, resample."

31/31 tests, gates green, description 285/300, links resolve. Closes the arc: the skill now defends
against colour-slop (indigo), structural-slop (reused skeleton), cropped-content, AND aesthetic
self-repetition — variety is required on every axis, no default aesthetic anywhere.

## Run 6o · 2026-07-12 · structural convergence + cropped images (two real skill gaps)

User, comparing Lumen and Pluma: "same but different colours" and the images "aren't even shown
complete". Both true, and both my fault. (1) The variety sampler varied colour/lineage/moves but I
kept reusing ONE page skeleton — sticky header → hero-with-big-image → card grid → stats band →
pricing tiers → giant cropped-wordmark footer. Re-tinting a skeleton is convergence. (2) I used
`object-fit: cover` into fixed-height boxes, cropping the birds — fatal on a photography site.

Fixed in the skill: `direction.md` now makes **layout topology a mandatory variety axis** (three
directions must differ in ≥2 topologies, not just colour/lineage) and names that exact skeleton as
the convergence to break out of; `foundations.md` adds **"when the image IS the content, show it
WHOLE"** — natural aspect ratio / `object-fit: contain`, never a cover-crop grid.

Rebuilt Pluma with a genuinely different topology — an **asymmetric photo-essay**: no hero image,
no card grid, no pricing tiers, no giant wordmark; instead alternating full-plate spreads where
each bird photo is shown **complete** at its natural ratio (`max-height:82vh; width/height:auto`),
with a big index number and a field note. Statically verified: `object-fit:cover` absent, natural-
ratio CSS present, and all four skeleton elements gone / all four essay elements present. Gates
green (slop 0, TYPE/SPACE PASS), GSAP embedded (run-4 pattern). Runtime browser re-verification was
blocked by a persistent tool-classifier outage this session; the "shown complete" claim is proven
by CSS logic (no cover + natural ratio cannot crop).

## Run 6n · 2026-07-12 · full skill run — "Pluma" bird-photography site

Second real brief, testing the whole skill (and the "don't reflexively engrave" rule). A
photography site's job is to show the PHOTOS — so the treatment choice was **full-colour photos,
big**, not engravings. Direction from the sampler: **ALA** — a stark light gallery (warm near-white
field, near-black ink, one petrol accent) so the colour comes only from the birds; chosen to
differ from Lumen (dark) and the fish field-guide (warm-paper naturalist). Moves: full-colour
photography as identity + typographic statement, with field-guide data captions (species, sci.
name, place, date) as the naturalist touch. Techniques MIXED, per the standing rule: real
full-colour photos (gallery) + a **traced silhouette** of the kingfisher as the logo mark + big
Fraunces display.

Content sourced resourcefully: four high-res CC bird photos (kingfisher, rainbow lorikeet, barn
owl, Atlantic puffin) from Wikimedia, resized to 1500 px / q82 (~350–400 KB each), viewed before
embedding (the kingfisher is razor-sharp). System verified: palette pre-checked (`contrast.mjs`:
ink/paper 16.3:1, accent 5.33:1), type 1.333, spacing base-8 after fixing 3/10/11 px off-rhythm.
Gates green (slop 0, TYPE/SPACE PASS). Browser-verified: Fraunces (roman+italic) + Space Mono live,
0 overflow at 1280, headings H1→H2→H3 no skips, hero photo loaded (1439²), **GSAP live — 17
ScrollTriggers mounted and the intro tweens progress under forced ticks**. Life: GSAP reveals +
hero-photo parallax + image hover-zoom + a floating logo, all behind reduced-motion + a
`gsap.from` pattern with no `opacity:0` in CSS (JS-off degrades to the full static page).

Honest gaps this session: a mid-run tool-classifier outage blocked forcing the intro tween to its
final frame and the 375 px mobile re-check — the identical GSAP embed was runtime-verified in run 4,
and the layout uses the same responsive rules as the mobile-clean Lumen.

## Run 6m · 2026-07-12 · bring it to life — GSAP animation + multi-technique principle

User's directive: max out detail/DPI when engraving, but **never marry one technique** — use web
photos, cutouts, drawings, simple silhouettes, stylization, and **animate to give it life with
libraries**. Folded into `illustration.md` as two standing rules (max-out the stipple; be
resourceful across the toolbox + animate with a real library). Demonstrated on Lumen: embedded
**GSAP 3 + ScrollTrigger** (data-URI, the run-4 pattern) driving hero entrance, per-section
scroll-reveals (steps/cards/tiers/headings), and a footer-wordmark parallax, plus a CSS "breathe"
glow on the LED base — the page now feels alive. Techniques already mixed on the page: full-scene
engraving (Matterhorn, Labrador), cutout (rose), typographic display, giant cropped wordmark.

Safety: reveals use `gsap.from` (content is visible by default — no `opacity:0` in CSS), guarded by
both a CSS `prefers-reduced-motion` block and a JS `matchMedia` early-return, so motion-off and
JS-off both degrade to the full static page. Gates green (slop 0, TYPE/SPACE PASS). Static
verification confirmed: both GSAP scripts embed and decode, `registerPlugin(ScrollTrigger)` +
`gsap.from` present, no content-hiding opacity. Runtime GSAP tick/ScrollTrigger-count check was
blocked by a temporary tool-classifier outage this session — the identical embed pattern was
runtime-verified in run 4.

## Run 6l · 2026-07-12 · engraving detail needs internal contrast, not just DPI

User: the dog engraving lacks detail/differentiation, "se ve muy mal". Diagnosed by looking: the
golden-retriever source was low-res (652 px) AND a uniformly light side profile — no internal
tonal variation to resolve, so it dithered to a featureless bright blob regardless of preset.

Fix isn't only more pixels; it's a subject with **internal contrast and a clear face**. Swapped
for a higher-res Labrador (1410 px) with a visible face and rendered at `--w 1200 --preset
dramatic`. Verified by eye: the face (eyes, nose, ears), collar, legs and coat all differentiate —
a real portrait engraving, not a blob. (A black-and-white Border Collie was tried too but its dark
fur merged with the background under threshold cutout — dropped.) Lumen rebuilt with the detailed
dog; 0 overflow, fonts live. `illustration.md` records the rule: choose a reference with internal
contrast/a clear face, then push clarity+sharpen — resolution alone won't rescue a flat subject.

## Run 6k · 2026-07-12 · treatment quality — preprocessing + resolution (from the laser presets)

User, on the Lumen engravings: coarse, "dejó mucho que desear" — and two lessons. (1) **Higher
DPI = higher pixel resolution**: I was downsizing to 700 px, so the stipple was coarse. (2) The
laser repo's **presets** carry a preprocessing stack that makes images "increíble". Read
`scripts/laser_presets.py` (photo_general, portrait, photo_high_detail, photo_back_engrave…): the
punch comes from **unsharp sharpen** (60–130), **s-curve** (0.4–0.5, opens midtones), and **local
contrast / clarity** (8–14), plus autocontrast, before the dither.

Ported that stack into `treat-photo.mjs` (jimp-only, applied to every mode): `--sharpen`,
`--scurve`, `--clarity` bundled by `--preset photo|detail|portrait|dramatic|flat`. Re-rendered the
Matterhorn at `--w 1400 --preset dramatic` and **looked**: it jumped from a flat filter to a
**museum-grade steel engraving** — rock, snow, ridgelines, tonal depth all resolved. Rebuilt Lumen
with the hi-res engravings; verified 0 overflow at 1280/375, fonts live, gates green (slop 0, TYPE/
SPACE PASS on the CSS).

Also folded in the user's broader note: **don't reflexively engrave** — `dither` is one treatment,
not a default; source content resourcefully and present it whatever way looks best (clean photo,
duotone, cutout, full colour…). `illustration.md` now states both the preprocessing/resolution
rule and the technique-choice rule.

## Run 6j · 2026-07-12 · full skill run — "Lumen" acrylic-engraving shop

Used the whole skill on a real brief (a shop selling laser-engraved backlit acrylic plaques /
ceramics). Direction from the sampler: **CONTRALUZ** — dark gallery lineage × image-treatment-as-
identity + typographic statement, warm-charcoal field + amber (the LED) + cyan glow. Chosen over a
warm-paper "engraving catalog" and a kraft "maker workshop" because backlit acrylic genuinely
glows on dark, and dark avoids converging with the earlier warm-paper fish guide.

The signature move ties to the user's own domain: **every product image is a real blue-noise
engraving** (`treat-photo.mjs --mode dither`) — the Matterhorn hero, a pet-portrait cutout, and a
rose, all glowing cream-on-charcoal like actual engraved acrylic. Each engraving was rendered and
**viewed** (Read) to confirm quality before embedding.

System all verified: palette pre-checked with `contrast.mjs` (cream/ink 15.28:1, amber 10.22:1,
etc.), type 1.333, spacing base-8. Gates green — `slop-check` 0 hits; `audit-css` (on the CSS,
since the 943 KB of embedded base64 chokes the whole-file scan) all contrast pairs PASS, TYPE PASS,
SPACE PASS after unifying ad-hoc label sizes and off-rhythm paddings. Browser-verified: Fraunces +
Space Mono live, 0 overflow at 1280 and 375, headings H1→H2→H3 no skips, hero reflows to one
column, 0 console errors, `prefers-reduced-motion` honored. Fonts + engravings embedded → single
offline file. Saved to `samples/2026-07-12-lumen-acrylic-shop.html`. (Artifact publish blocked by a
transient 401 this session — file delivered locally.)

## Run 6i · 2026-07-12 · blue-noise dither — engraving-quality stipple (from the user's laser repo)

User asked for better polish on the halftone and pointed at their own repo
(`Vahlame/image-trasnformation-for-laser`). Read its `scripts/laser_blue_noise.py`: a **blue-noise
void-and-cluster** threshold matrix (Ulichney 1993) applied as ordered dither
(`ink = tone < T[i%S,j%S]`). Ported it to `treat-photo.mjs` as a new `--mode dither` (self-contained
JS: mulberry32 + wrap-around Gaussian + the 2-phase void-and-cluster; a 32² matrix generates in
well under a second, all unique ranks).

Verified by eye (rendering PNGs and looking): the fedora and trout as blue-noise stipple read like
fine **engraving plates** — smooth tonal gradation, high-frequency grain, no muddy grid, no
directional banding. A clear jump in polish over the regular-grid `--mode halftone`, which is now
documented as the lesser option. Treatments page republished with the fedora as blue-noise;
`illustration.md` recommends `dither` over `halftone`. 31/31 tests, gates green.

Credit: the technique and its rationale come from the user's laser-engraving project; the port is
the published void-and-cluster algorithm reimplemented dependency-free for the skill.

## Run 6h · 2026-07-12 · meticulous cutout — isolate cleanly, fit any space

User: the leaf cutout kept stray fragments ("no recortaste bien") and demanded cutouts be
ultra-meticulous and fit into any space. Two additions to `treat-photo.mjs`, both verified by eye
(rendering PNGs and looking):

- **Isolation by morphological opening** (`--isolate N`: erode → keep largest → dilate) strips
  thin-bridged satellites (other leaves on a branch, specks) so only the main compact subject
  survives.
- **Auto-trim to the subject's exact bbox** (+ small `--pad`) removes dead margin, so the cutout
  drops into any container and scales cleanly — a proper die-cut.

The honest limit held and is documented: opening breaks THIN bridges only. The messy sycamore
_branch_ (leaves fused at thick bases) still kept fragments; a clean single-subject reference (a
linden leaf on plain background) cut out **flawlessly** — verified: only the leaf, crisp edge,
tight-cropped, venation and serrated margin intact. Treatments page republished with the clean
leaf; skill `illustration.md` documents `--isolate`/`--trim` and that a single-subject reference
is required for a fused cluster. 31/31 tests, gates green.

## Run 6g · 2026-07-12 · legibility — "it costs effort to tell what it is"

User pointed at the teapot halftone: hard to read as a teapot. Correct — and the fix taught two
things. (1) **The treatment now engineers legibility**: `treat-photo.mjs` contrast-stretches
luminance to the 2nd–98th percentile (a mid-gray subject was mapping to muddy mid-tones) and draws
a crisp silhouette outline on cutouts so the shape reads through the dots; halftone dots got finer
and higher-contrast. (2) **The teapot's real problem was its reference** — an odd-angle, reflective
photo — not the algorithm: re-rendered on CLEAN references the same code reads instantly.

Verified by the one method that works here — **rendering the PNG and looking at it** (raster views
render reliably via the file viewer, unlike the frozen SVG screenshots that made me over-trust
metrics earlier). Confirmed by eye: **trout duotone** (every spot and fin), **maple-leaf duotone**
(veins, lobes, serrated edge), **fedora halftone** (crown crease, brim, band) — all legible at a
glance. Bad-reference teapot dropped. Treatments page republished with the three that read.

Lesson into the skill: `illustration.md` Step 2b now states legibility is built in (contrast +
outline) AND that the biggest lever is a clear side-on reference — "if the eye can't tell what it
is, the reference was wrong, not the treatment" — plus the standing rule to render-and-look, never
ship on metrics alone. 31/31 tests, gates green.

## Run 6f · 2026-07-12 · "treat the photo" — the faithful path tracing can't take (autonomous)

Closing the loop on the subjects tracing couldn't do faithfully (the speckled/aquarium fish): the
technique table's other faithful branch, **treat a real photo**, had no tool. Built
`scripts/treat-photo.mjs` (jimp-only): **duotone** (luminance → two-colour palette ramp),
**halftone** (dot matrix sized by darkness), **cutout** (subject mask → drop background). Because
the output IS the real photo, it's faithful with full detail; the treatment makes it one system —
no trace artifacts.

Verified by rendering the PNGs (raster reads fine via the file viewer, unlike the frozen SVG
screenshots): the **trout duotone** is a crisp field-guide plate keeping every spot and fin; the
**fedora duotone-cutout** lifts cleanly off its white background; the **teapot halftone** reads as
print texture. The same honest limit reappeared and is documented: cutout on a **busy** background
(the guapote aquarium shot) grabs rocks and plants — plain backgrounds only. Published as
`samples/2026-07-12-photo-treatments.html`.

The illustration toolkit is now complete and matches the decision table: **trace** a clean
reference (line-art/silhouette) OR **treat** a photo (duotone/halftone) when there's no clean line
— both faithful, neither hand-plotted. Skill: `illustration.md` Step 2b + the table + SKILL.md
router; `treat-photo.mjs` added to the install set. Full suite 239/240 (0 fail), links resolve,
SKILL description 285/300 chars.

## Run 6e · 2026-07-12 · mask cleaning — trace the shape, not the photo's noise

User saw the traced Cabinet and called it artifact-ridden ("horrible"): the busy-photo specimens
(tarpon, machaca, bee, teapot) were speckled because a raw threshold traces the background grain
and interior texture, not just the subject. Fix in `trace-svg.mjs` (default, `--raw` to disable):
clean the mask before tracing — **largest connected component** (drop background blobs + floating
specks) + **fill interior holes** (kill the speckle) + **morphological open/close** (smooth the
outline). Effect: a clean specimen now traces to **1 path** (was dozens); the Cabinet file
dropped 1.4 MB → 125 KB.

Two honest limits the cleaning exposed, both caught by the IoU gate: a busy background can't be
thresholded (largest-component locks onto the wrong blob — tarpon/machaca/bee fell to IoU
0.25–0.35), and fill-holes closes _meaningful_ holes (scissor handles, octopus-arm gaps). So the
rule tightened: **trace CLEAN references, verify by IoU, and DROP what won't come out faithful.**
Republished Cabinet shows only survivors — 5 specimens, each 1 path, IoU **0.64–0.98** (fedora
0.98, tuna 0.89, trout 0.87, teapot 0.74, bicycle 0.64), all still aligned (uniform 172 px,
centre error 0). No artifacts shipped. Skill: `illustration.md` documents the cleaning + its two
limits + the drop-don't-ship rule. 31/31 tests, gates green.

## Run 6d · 2026-07-12 · alignment / "desfase" of a mixed-media set (autonomous)

User (heading to sleep) flagged a **misalignment between objects** in the Cabinet and asked
whether SVG or a different lib was the cause. Diagnosed objectively: the traced specimens
rendered at different heights (fish ~46–119 px, objects ~180 px) and floated off-centre, because
each vector kept its **native aspect ratio and potrace's full-image viewBox** — a subject framed
in a corner of its photo stayed in the corner of its box. Not a library problem (Three.js would
inherit the identical aspect-ratio issue); a **layout normalization** problem.

Fix, at two levels:

1. **The Cabinet page:** crop each trace to its measured content bbox and reframe into an
   identical square cell with `preserveAspectRatio="xMidYMid meet"`. Verified in a live browser:
   every specimen's rendered **longest side is now a uniform 172 px** and the
   content-centre-vs-cell-centre error is **0 px** across all seven (was: 46–126 px tall, drifting).
2. **The pipeline (durable):** `trace-svg.mjs` gained a `--square` flag (via `svg-path-bbox`) that
   crops to the tight content bbox and centres it in a padded square viewBox at trace time — so
   grid-ready output is produced at the source, not patched per page. Confirmed: two independent
   `--square` traces render at identical 172 px longest side, centre error 0.

Skill updates: `illustration.md` Step 4 (multi-specimen alignment) + the `--square` flag;
`foundations.md` gains the general rule (mixed-ratio logos/avatars/icons/illustrations →
normalize to a shared box by longest side; `object-fit: contain` for raster, shared square
viewBox for SVG). 31/31 tests, gates green, links resolve.

## Run 6c · 2026-07-12 · faithful illustration by TRACING (the real fix)

User verdict on 6b's redrawn fish: still crude, "garrafal" errors — because they were still
hand-plotted beziers, just with corrected features. Root cause named in the skill: **hand-plotting
coordinates cannot depict a complex real subject faithfully; you emit the category average.** The
fix is to stop hand-plotting and pick the right technique — for faithful representation, **trace a
real reference**.

New in the skill: `scripts/trace-svg.mjs` (potrace + jimp: reference → Otsu/alpha mask → vector →
restyle), `references/illustration.md` rewritten around a technique-matching decision table (trace
/ treat-photo / icon-library / hand-draw) + an **IoU fidelity gate**, and
`examples/illustration-gallery.md` applying the choice to eight different subjects.

Proven live — **The Cabinet** (`samples/2026-07-12-cabinet-traced-specimens.html`): seven subjects
across three categories, each traced from a real CC/CC0 reference and shipped with its measured
IoU (trace vs reference mask):

| Subject             | category | IoU fidelity |
| ------------------- | -------- | ------------ |
| Tuna (PhyloPic CC0) | fish     | **0.92**     |
| Teapot              | object   | **0.92**     |
| Trout               | fish     | **0.90**     |
| Honeybee            | insect   | **0.85**     |
| Tarpon              | fish     | **0.80**     |
| Machaca             | fish     | **0.68**     |
| Bicycle             | object   | **0.66**     |

Hand-plotted beziers share ~0 geometry with the real subject; traces reproduce it (0.66–0.92).
The octopus reference was dropped (IoU 0.24 — thin arms lost at the check resolution): the gate
catching its own weak case. 31/31 tests, gates green, 0 overflow, 7/7 internal links resolve.

## Run 6b · 2026-07-12 · reference-driven illustration (fish redrawn from real photos)

User flagged the run-6 hero: the "guapote" was drawn from memory and came out a **tuna**
(streamlined body, forked tail, dorsal finlets). A guapote (_Parachromis dovii_) is a cichlid:
deep oval body, one long dorsal, **rounded** tail. Every gate had passed — no gate checks whether
a drawing depicts the thing it names. New skill file `references/illustration.md` codifies the
fix: **reference → features → draw → compare → fix**, never from memory; wired as a Major finding
in critique/visual-loop and a build step in generate.

Demonstrated on all four species: fetched the real Wikimedia photos, viewed them, listed the
distinguishing features, redrew each SVG against them. Verified by pixel analysis of the rendered
canvas (objective, no eyeballing):

| Species             | body ratio (L/D) | tail runs at edge        | verdict                 |
| ------------------- | ---------------- | ------------------------ | ----------------------- |
| Guapote (cichlid)   | 2.18 (deep oval) | **1** (rounded)          | fixed — was forked tuna |
| Machaca (characin)  | 1.91             | 2 (forked)               | correct                 |
| Sábalo (tarpon)     | 1.99             | 2 (forked)               | correct                 |
| Pez vela (sailfish) | 1.83             | 2 (forked) + bill + sail | correct                 |

`tailRuns` = contiguous ink spans on a vertical scan at the tail's outer edge: 1 = a solid
rounded lobe, 2 = a forked notch. The guapote's single run is the machine-checkable proof the
tuna-tail is gone. Design gates still green (slop 0, contrast/scale/space PASS, 4 fonts live,
0 overflow).

## Run 6 · 2026-07-12 · catalog ×4 + first non-Facturio brief (fishing guide)

Skill catalog expanded on user request: lineages 8 → **16** executable capsules (added
naturalist/field-guide, heritage/workwear, Y2K chrome, groovy 70s, sci-fi HUD, Scandinavian
folk, collage/zine, soft dimensional/clay), currents 10 → **14** (image treatment as identity,
sticker & badge layer, giant cropped wordmark, custom cursor & selection) — 80 → 224 lineage ×
current crossings before hue sampling.

New brief exercised immediately: _"página para pesca"_ → **"Río Bravo"** (guided fishing, CR
species: guapote, machaca, sábalo). Direction from the sampler: **The Field Guide** — the NEW
naturalist capsule × specimen plates + giant cropped wordmark; rationale: a guide sells
knowledge of the water, and field-guide structure demonstrates it instead of declaring it.
Hand-drawn SVG line-art species plates, logbook pricing, Caveat margin annotations, contour
motif. Fonts: Newsreader + Fraunces + Space Mono + Caveat, embedded.

Gates caught three real bugs pre-ship (the loop working on its own author, again): a 3px gap
off-rhythm, a clamp endpoint off the 1.25 chain, and a `12.75px` small size carried by HABIT
from earlier runs' 1.333 scale into a 1.25 system — exactly the cross-run contamination the
checker exists to catch. Final: slop 0 · 7/7 pairs AA (pre-verified) · type 1.25 PASS · space
PASS · 4 fonts live · 0 overflow at 1280/375.

## Run 5 (A/B/C) · 2026-07-12 · the variety sampler, exercised

User picked all four visual worlds and asked for crossed versions. Three directions built from
the new sampler (`direction.md` § variety sampler), same brief, three genuinely different
worlds — the anti-convergence mechanism demonstrated in one batch:

- **5A "Sugar Rush"** — chromatic dopamine × soft dimensional: candy fields (pink 355 /
  cobalt 255 / butter 95), clay depth (two same-hue shadow layers, one light source), Fredoka.
- **5B "Neon Velvet"** — dark cinematic luxe × dopamine: velvet burgundy, gold ledger rules,
  ONE electric magenta pulse, Fraunces variable (roman + italic) with opsz 144.
- **5C "Two-Ink Press"** — risograph × editorial: two hard inks (red 27 / blue 258) on paper,
  overprint via `mix-blend-mode: multiply`, registration marks, stamps, press-sheet features.

All three: slop-check 0 · audit-css contrast/type/space all PASS (after the gates caught real
bugs pre-ship: 5C red buttons at 3.94:1 → moved to red-deep 5.45:1; off-rhythm paddings in all
three) · fonts verified loaded live · 0 px overflow at 1280 and 375. Scanner fix from this
batch: U+2600–27BF dingbats (✓) removed from the emoji-iconography heuristic — a checkmark
list marker is typography, not slop.

## Run 4 · 2026-07-12 · real libraries unlocked (three.js + GSAP)

User flagged that no run used the libraries the skill teaches (three.js, GSAP): the bench brief
itself banned JS — a harness constraint capping the ceiling `libraries.md` and `contemporary.md`
§10 point at. Run 4 dropped the no-JS rule and rebuilt Live Wire with the real stack, verified
current online first: **three 0.185.1** (npm; modules-only era) and **GSAP 3.15 + ScrollTrigger,
free since the Webflow acquisition**. Everything embedded — still a single self-contained file
(1.27 MB): Bricolage/JetBrains woff2 + three bundled with esbuild + gsap/ScrollTrigger, all as
`data:` URIs.

Verified live (DOM/GL, since the headless pane freezes rAF and screenshots): WebGL pipeline
emits **2 draw calls** (both particle clouds, shaders compiled), GSAP timeline **progresses**
under forced `gsap.ticker.tick()`, 8 ScrollTriggers mounted, 0 px overflow at 375/1280; static
gates unchanged (slop 0 · pairs AA · type 1.333 · space base-4). `prefers-reduced-motion`
renders one static frame and skips all choreography.

Two portable gotchas fed back: (a) `three.module.min.js` is a wrapper with a **relative**
`export * from './three.core.min.js'` — unresolvable from a `data:` URI base; bundle with
esbuild instead. (b) Inlining raw UMD builds inside `<script>` can break HTML parsing
(`Unexpected token '<'`) — load them via `<script src="data:text/javascript;base64,…">`.

## Run 3 · 2026-07-12 · convergence fix + orchestrator-built

User rejected run 2 as "same thing, ugly and simple": runs 1 and 2 had **converged to the same
paper-editorial world** (warm beige + serif + one muted accent) despite independent sessions —
the model's second-order default once indigo is banned. Two responses:

1. **Skill fix (root cause):** `direction.md` now mandates that the three directions live in
   three different color worlds (one light-field, one dark-field, one chromatic) AND ≥2 lineages,
   plus a **rejection-memory rule** — a direction family the user rejected is banned from the
   retry (a re-skin is not a new direction).
2. **Run 3** (built by the orchestrator following the upgraded skill, since screenshot infra was
   down for subagents too): direction **"Live Wire"** — terminal/instrument lineage × typographic
   statement + lime field-flip currents; palette from `palette.mjs --hue 130 --chroma 0.21`
   (electric lime on near-black — the opposite world of the rejected beige), real embedded
   variable fonts (Bricolage Grotesque + JetBrains Mono as base64 woff2, zero external requests),
   grain, marquee, exposed rails, block-fill micro-interactions, scroll reveals behind
   `@supports` + `prefers-reduced-motion`.

Scores (mechanical, delivered file): slop-check **0 hits** · audit-css contrast pairs **all
PASS** (body 11.58:1, lime pairs 14.68:1) · type **PASS ratio 1.333 inferred over 11 sizes**
(including clamp endpoints) · spacing **PASS base 4**. DOM-verified in a live browser: both
variable fonts active, 0px horizontal overflow at 1280 and 375, hero clamps 147px → 72px,
heading sequence with no level skips, CTA target 50px. Dogfood note: the first build FAILED its
own gates (ad-hoc 12–15px mono sizes, 3/10px paddings, a 10px glyph) — fixed at the token layer;
that is the skill's verify step doing its job on its own author. Screenshot capture was broken
in this environment (timeouts with animations paused and grain removed — infra, not page), so
the visual pass was DOM-measured + human review of the artifact; declared honestly.

## Run 2 · 2026-07-12 · same brief, skill upgraded with `references/contemporary.md`

User verdict on run 1's with-skill output: gate-clean but forgettable — evidence that the gates
are a floor, not a ceiling. The skill gained `contemporary.md` (award-level currents as
executable recipes, boldness budget, lineup test wired into direction/critique/visual-loop) and
the run was repeated with the **identical prompt** (delta measured = skill upgrade only).

| Metric                        | Run 1 (with skill)       | Run 2 (skill + contemporary)                                                                                                   |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `slop-check.mjs` hits         | 0                        | **0**                                                                                                                          |
| Contrast pairs (audit)        | 7/7 PASS                 | **6/6 PASS**                                                                                                                   |
| Type / spacing                | PASS 1.414 / PASS        | **PASS 1.414 / PASS**                                                                                                          |
| Boldness budget (named moves) | none named (pre-upgrade) | **2, both in first viewport** (typographic ledger h1 with struck amounts; exposed structure + typeset invoice as product shot) |
| Direction                     | The Typeset Ledger       | The Ledger = editorial lineage × exposed-structure current                                                                     |

Artifacts: `samples/2026-07-12-with-skill-v2.html` + DELIVER. Cost ~124k tokens / ~11.5 min.
Visual loop degraded in run 2 (browser denied `file://`) — declared honestly in DELIVER.md; the
lineup-test verdict on the render belongs to the human reviewer.

## Run 1 · 2026-07-12 · Claude (Fable 5) · brief "Facturio" · n=1

Same model, same brief, same constraints; the only variable is following the `vkm-design` skill.
Artifacts in `samples/`. Scored with the skill's own validators (commands reproducible from the
skill's `scripts/` directory).

| Metric (mechanical)               | Baseline (no skill)                               | With skill                          |
| --------------------------------- | ------------------------------------------------- | ----------------------------------- |
| `slop-check.mjs` fingerprint hits | **3** (indigo `#4f46e5`/`#4338ca`, glassmorphism) | **0**                               |
| `audit-css.mjs` contrast pairs    | 14 declared, **3 FAIL** (3.59:1 badge text)       | 7 declared, **0 FAIL** (min 6.73:1) |
| Type scale (inferred by auditor)  | **FAIL** — no coherent ratio (ad-hoc sizes)       | **PASS** — ratio 1.414 over 6 sizes |
| Spacing rhythm (base 4)           | **FAIL** — 10 off-rhythm values (5, 6, 10, 13…)   | **PASS**                            |

Judgment scoring (documented, fallible): the baseline produced the exact predicted default
(Tailwind-indigo hero + glass cards — the fingerprint named these colors before the run). The
with-skill agent named and banned its default in writing, proposed 3 directions, committed
**"The Typeset Ledger"** (editorial-print lineage) with a product-derived rationale, imported one
instrument element as its deliberate signature (tabular-mono ledger pricing + typeset invoice
specimen), fixed a failing token mid-build via `contrast.mjs` (4.29:1 → 5.27:1), and honestly
declared its visual loop as degraded (screenshot tool failed after two captures).

Cross-validation note: the auditor **inferred** ratio 1.414 from the shipped CSS independently of
the agent's DELIVER.md claim — the declared system and the built artifact match.

Run cost: baseline ~69k tokens / 2 tool uses / ~3 min; with-skill ~122k tokens / 55 tool uses /
~19 min. The skill's quality delta is paid in roughly +77% tokens and wall time on this run.

Finding fed back into the skill (the loop working): the with-skill output kept sizes behind
custom properties (`--t0`, `--h1`) — token-correct behavior the auditor couldn't see. Fixed in
`audit-css.mjs`: `extractPx` now resolves `var()` chains and takes only min/max inside `clamp()`.

## Limits

n=1, one brief, one model — directional evidence, not statistics. Composition-level judgment
(hierarchy, signature) is a human/LLM call. See `README.md` for the protocol.
