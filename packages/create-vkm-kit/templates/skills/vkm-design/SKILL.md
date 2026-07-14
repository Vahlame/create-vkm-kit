---
name: vkm-design
description: Professional, anti-generic UI/UX and visual design method for any medium — web, desktop, dataviz, brand. Forces a named design direction before code, computed checks (contrast, scale), real current libraries, and a visual self-critique loop. Invoke for any design, styling, or UI task.
user-invocable: true
---

# vkm-design — design like a trained professional

Installed by create-vkm-kit (vkm-kit). One job: make design output **professional and
distinctive** — never the template every model ships by default, never precise-but-dead. Works for
any deliverable a human will look at: a screen, a component, a dashboard, a landing page, a desktop
app, a chart, a logo, a slide.

## The contract — every mode, every medium

1. **Think like a designer first.** Read [`references/designer-mind.md`](references/designer-mind.md)
   before any design work — it is the operating system for this skill: the process, the crit
   vocabulary, and the questions a trained designer runs in order. Everything else hangs off it.
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

## Scale the ceremony to the task

The full protocol is for surfaces, not for every pixel:

- **New surface/product/identity** → everything: direction (3 options) + token system + build +
  visual loop.
- **Edit inside an existing design** → NO new direction. Reconstruct the incumbent one
  ([`modes/critique.md`](modes/critique.md) § "Inferring the incumbent direction" —
  `audit-css.mjs` + `scale.mjs` do the measuring), state it in one line, and derive the edit
  from it; foundations + the a11y gate still apply. Inventing a second direction inside
  someone's system is its own kind of slop.
- **Micro-task** (one control, one color, one label) → foundations numbers + computed check on
  what changed. Done.

Misjudging up wastes tokens; misjudging down ships an incoherent system — when unsure, ask which
surface this belongs to.

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
