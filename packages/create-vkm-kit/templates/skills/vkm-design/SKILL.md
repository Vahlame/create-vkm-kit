---
name: vkm-design
description: Professional, anti-generic design for REAL design work — a new surface, a redesign, an identity, dataviz, or a design critique. Forces a 3-line brief, a named direction, computed checks and verified-current libraries. NOT for one-line style tweaks, or logic with no visible surface.
user-invocable: true
---

# vkm-design — design like a trained professional

Installed by create-vkm-kit (vkm-kit). One job: make design output **professional and
distinctive** — never the template every model ships by default, never precise-but-dead. Works for
any deliverable a human will look at: a screen, a component, a dashboard, a landing page, a desktop
app, a chart, a logo, a slide.

**This skill has NO house style.** It never prescribes one aesthetic — no default typeface, colour
world, or layout. Its entire job is to pick the style THIS brief earns and to make consecutive
builds NOT rhyme. Any example here (a serif on warm paper, a dark-luxe hero) illustrates the
_method_, never a target look — copying the example's aesthetic is the failure it teaches against.
If your output is starting to have a recognizable signature across unrelated briefs, that is slop
(`references/direction.md` § your own house style); rotate lineage, type pairing, colour world and
layout topology every time.

## Step 0 — the brief and the tier (ALWAYS, before reading anything else)

The historic failure of this skill is scope without an objective: it read everything,
designed for nobody in particular, and hallucinated the rest. So every invocation starts by
writing THE BRIEF, three lines, shown to the user:

```text
For:         <who looks at this, in what situation>
Must do:     <the one thing the design has to achieve — not "look nice">
Constraints: <incumbent system? platform? brand? deadline-cheap or flagship?>
```

Then pick the TIER — the tier decides how much of this skill you load, and reading MORE
than your tier is the token-waste failure, not diligence:

| Tier                                                   | What you read                                                   | What you do                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Micro** — one control, one color, one label          | nothing (formulas inline below via `references/foundations.md`) | foundations numbers + ONE computed check on what changed. Done.          |
| **Edit** — change inside an existing design            | `modes/critique.md` § inferring the incumbent direction         | reconstruct the incumbent direction in one line, derive the edit from it |
| **Surface** — new screen/product/identity, or redesign | the full contract below                                         | direction (options) + tokens + build + visual loop                       |

If the brief cannot be filled from the request plus the codebase, ask ONE closed question.
A design without a "Must do" line is decoration — do not start.

## The contract — Surface tier (and the spirit of every tier)

1. **Think like a designer first.** Read [`references/designer-mind.md`](references/designer-mind.md)
   before surface-tier design work — it is the operating system for this skill: the process, the
   crit vocabulary, and the questions a trained designer runs in order. Everything hangs off it.
2. **Direction before pixels.** No code, no CSS, no tokens until a design direction is named and
   committed via [`references/direction.md`](references/direction.md). This is the anti-generic
   engine: it forces you to notice your default and diverge from it deliberately.
   [`references/lineages.md`](references/lineages.md) turns each direction into an executable
   recipe (real typefaces, OKLCH seeds, shape/motion numbers), and
   [`examples/worked-example.md`](examples/worked-example.md) shows one full pass, brief →
   deliver, with real validator output — read it once before your first generate-mode task.
3. **Computed, never eyeballed.** Contrast ratios, type scales and spacing rhythm are numbers.
   Run [`scripts/contrast.mjs`](scripts/contrast.mjs) (hex AND `oklch()` input),
   [`scripts/scale.mjs`](scripts/scale.mjs) (check or `--gen`),
   [`scripts/palette.mjs`](scripts/palette.mjs) (gamut-aware OKLCH ramps + AA-guaranteed
   semantic tokens, key pairs pre-computed), [`scripts/audit-css.mjs`](scripts/audit-css.mjs)
   (static audit of an existing stylesheet: declared color pairs, scale, rhythm) and
   [`scripts/slop-check.mjs`](scripts/slop-check.mjs) (the direction fingerprint, mechanized —
   run it on your own output) — Node ≥ 18, zero deps. No shell? The formulas are inline in
   [`references/foundations.md`](references/foundations.md) — compute them by hand and show the math.
4. **Real libraries, verified live.** Style with real, current tools — component foundations, motion
   libraries, real fonts, real icon sets — per [`references/libraries.md`](references/libraries.md).
   Its hard rule: verify the current version and API online before use; never scaffold from memory.
5. **Memorable, not just correct.** Passing every gate is the FLOOR. Each new surface commits
   1–2 high-intensity moves from [`references/contemporary.md`](references/contemporary.md)
   (the currents alive in award-level work, with recipes) and must pass its **lineup test**:
   first viewport, logo hidden — if it can't be picked out of ten templates, the assignment
   failed even with every gate green.
6. **Accessibility is in the definition of done.** If the `vkm-discipline` skill is installed, its
   `domains/design-ui.md` is the acceptance gate (computed contrast per theme, keyboard-only flow,
   empty/error/loading states, 200% zoom). Without it, the same gates are summarized in
   `references/foundations.md` — they are not optional either way.

## Route by mode

| The user wants…                                             | Load                                           |
| ----------------------------------------------------------- | ---------------------------------------------- |
| Something new designed/built (screen, app, chart, identity) | [`modes/generate.md`](modes/generate.md)       |
| An existing design judged (screenshot, code, URL)           | [`modes/critique.md`](modes/critique.md)       |
| Iterate visually — render, self-critique, fix, repeat       | [`modes/visual-loop.md`](modes/visual-loop.md) |
| Specs another dev/agent will implement (tokens, redlines)   | [`modes/handoff.md`](modes/handoff.md)         |

Generate mode ends with a visual-loop pass when a renderer is available — the modes compose.
When the ask is "this existing GUI looks broken" (defects, not direction), the `vkm-ui-judge`
skill is the sharper instrument: it measures the rendered page/app deterministically. Use it
for the defect pass and this skill for the design judgment on top.

## Rigor — what you may NOT invent

The hallucination surface of design work is names and numbers. Hard rules, every tier:

- **Numbers come from runs, not from prose.** A contrast ratio, scale step or spacing value
  is only claimable next to the script invocation (or the shown hand-math) that produced
  it. "AA-compliant" without a `contrast.mjs` line (or the arithmetic) is an unverified
  claim — label it as one or compute it.
- **Never name what you haven't verified.** A font, library, version, API or icon set may be
  cited only if it (a) already exists in the project, or (b) was verified live this session.
  No web access → say "unverified, from memory" next to the name, every time.
- **No invented authorities.** No made-up award examples, designer quotes, or "studies show".
  The lineup test and the computed gates are the whole authority this skill needs.
- **Checks that did not run say NOT RUN.** The degradation ladder (below) exists so honesty
  is always available; faking a green check is the one unforgivable output.
- **Edit tier never invents a second direction.** Inventing a new aesthetic inside someone
  else's system is slop with extra steps — reconstruct the incumbent and serve it.

Misjudging the tier up wastes tokens; misjudging down ships an incoherent system — when
unsure, ask which surface this belongs to.

## Route by medium

All media share the same designer-mind → direction → foundations spine; the medium picks the
library map section and the idiom notes in `references/libraries.md`:

- **Web/frontend** — HTML/CSS/React/Svelte/Vue, Tauri webviews.
- **Desktop native** — WPF, WinUI, Flutter, Avalonia: respect the platform idiom before inventing.
- **Dataviz** — charts, dashboards, dense tables: its own craft rules (direct labels, restrained
  palettes, no rainbow, no 3D).
- **Brand/visual** — logos, palettes, type systems, print-like artifacts: foundations +
  direction carry most of the weight; deliverables are tokens + specimens. Marks (logo,
  wordmark, favicon) have their own craft file: [`references/marks.md`](references/marks.md).

Any medium may include a **bespoke figurative drawing of a real thing** (a species, a product,
a landmark, a mascot). That triggers [`references/illustration.md`](references/illustration.md):
first pick the right technique for the subject (trace a reference, treat a photo, use an icon
library, or hand-draw only if it's abstract/authored), because **hand-plotting bézier coordinates
cannot depict a complex real subject faithfully** — a model emits the category average, so "a
fish" comes out a generic fish. Two real tools do the faithful work:
[`scripts/trace-svg.mjs`](scripts/trace-svg.mjs) turns a clean reference into a vector (fidelity
verified by IoU overlay, not by eye), and [`scripts/treat-photo.mjs`](scripts/treat-photo.mjs)
duotone/halftone/cutout-treats a real photo when there's no clean line to trace — faithful because
it IS the photo, stylized so it reads as one system.
[`examples/illustration-gallery.md`](examples/illustration-gallery.md) runs the technique choice
across eight different subjects.

## Memory (opt-in)

If the obsidian-memory-hybrid MCP responds: recall the project's existing design decisions
(palette, type, direction) with one `assemble_context` call before choosing a direction, and record
the committed direction as a `[decision]` observation at close. The skill is fully functional
without the vault — never block on it, never claim to have persisted if no MCP answered.

## Degradation ladder

No browser → static critique + computed checks (say the visual loop did not run). No shell →
hand-computed formulas from `foundations.md`, shown in the output. No web access → say library
versions are unverified and mark them as assumptions. Chat-only model with no tools at all → the
references still work as pure method; state what could not be verified.
