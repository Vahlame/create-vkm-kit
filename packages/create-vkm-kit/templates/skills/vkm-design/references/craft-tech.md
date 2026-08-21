# Craft-tech — visual technologies as a decoder, not a menu

Award-looking pages are not "more Inter". They are **a technology choice** (how light, type,
image and motion are actually made) in service of a direction. Models skip this and restyle
the same DOM: cards, a hero, a three-column grid, a CSS grain overlay.

This file names **categories** so you can recognise what a live precedent is doing and look
up the current how-to. It is not a picker. If you choose a category because it is on this
list, you have failed the file. Choose it because a URL in the live dossier (`inspiration.md`,
this folder) exhibits it.

## Contents

- The hard rule
- Categories (decoder)
- Pairing with the brief
- What this is not

## The hard rule

1. Name the category **after** the dossier, pointing at the URL that exhibits it.
2. Verify the current API/support online this session (CSS, SVG, canvas, a motion library,
   a native platform effect). Never scaffold from memory.
3. Spend the novelty budget on **1–2** categories at full intensity; the rest stays quiet
   (`direction.md` innovation guardrail).
4. Interaction conventions stay boring. Technology is identity, not a new way to submit a form.
5. Consecutive Surface builds must not reuse the same category unless the briefs are the
   same product. Rotate the _implementation_, not just the hue.

## Categories (decoder)

When you open a live page, ask which of these is doing the memorable work:

- **Type as architecture** — the headline _is_ the layout (optical size, width axis, outline
  vs fill, a crop by the viewport). Not "big Inter Bold".
- **Print / physical material** — the page behaves like paper, metal, a ticket, a manual:
  measures in `ch`, rules, overprint, duotone, show-through. Spacing is a grid you can feel.
- **Photographic treatment** — one treatment on every image (duotone, halftone, hard crop
  into a shape). Untreated stock + a white card is the fingerprint.
- **Spatial / editorial** — overlap, hanging punctuation, asymmetric columns, negative
  margin that was designed per breakpoint. Verify it does not collide at 360px.
- **Kinetic** — scroll-driven CSS (`animation-timeline`), View Transitions, a real motion
  library timeline, sticky panels that explain sequence. Not fade-up-on-scroll on every block.
- **Generative / drawn** — canvas, SVG filters/patterns, a shader, CSS `paint()` / pattern
  that _is_ the image. Hand-plotted béziers of a real species still fail; see `illustration.md`.
- **Light / ink / blend** — `mix-blend-mode`, multiply overlays, phosphor, riso. One blend
  language, not glassmorphism-on-everything.
- **Dense instrument** — the UI _is_ a table/readout. Mono numerals, 4px base, hairlines,
  zero gallery air. POS, ops, trading, cockpit.
- **Object / product / 3D** — a real photographed object, a honest CSS fake of depth, or a
  named WebGL dependency. A tilted screenshot with a drop shadow is not this category.

Look up **how they built it** on that page (DevTools, source, their blog) — then use the
current equivalent in this stack. The category name is not a CSS snippet.

## Pairing with the brief

A wedding stationery site that steals "dense instrument" has ignored the dossier. A POS
dashboard that steals "gallery air + cinematic grain" has too. The brief's job kills
categories; the dossier only proposes survivors.

## What this is not

- A replacement for foundations (contrast, type scale, spacing rhythm still compute).
- Permission to skip `vkm-ui-judge` layout checks. Kinetic and editorial overlap still
  cannot put text on text or text on the glass.
- A closed list of 14 "moves" to rotate through. If the live page is doing something that
  is not in this file, steal _that_, and write the category in one line.
