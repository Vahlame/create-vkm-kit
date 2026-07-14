# Facturio landing — delivery note

## Direction

**"The Ledger"** — editorial print lineage crossed with the *exposed structure* contemporary
current. Organizing sentence: **the landing page is a perfectly set invoice.**

- Default named and banned first: dark navy hero, indigo gradient, Inter, pill badge, two rounded
  CTAs, floating screenshot with glow, 3-column icon cards, purple middle pricing card, dark footer.
- Three directions proposed (The Ledger / Paper Instrument (Swiss) / Terminal Cashflow); The Ledger
  won on job fit: the product's output *is* a document, so typesetting the page as one is honest,
  derivable and memorable. Precedent: book frontmatter + the classic paper invoice.
- Boldness budget (2 moves, both in the first viewport): **typographic statement** — the h1 is a
  set of giant ledger line-items with dotted leaders and struck-through "pain" amounts; **exposed
  structure** — ruled rows, oversized item numerals, and an HTML/CSS invoice specimen instead of a
  product screenshot. Everything else stays quiet.
- Deliberate capsule deviation: the "product shot" is a typeset invoice document (the artifact the
  tool produces), not imagery — that is where the signature lives.

## Tokens (built first, computed not eyeballed)

- Type: system serif (Iowan Old Style / Palatino Linotype / Georgia…) + system mono; scale base 16,
  ratio 1.414 → 11.31 / 16 / 22.62 / 32 / 45.25 / 64 / 90.5 px; display sizes fluid with clamp()
  endpoints on the scale; ledger amounts at 0.5em = exactly two scale steps down (1.414² = 2).
- Space: base 8 (4 allowed as half step). Color: OKLCH — warm paper 0.96/0.01/85, ink 0.2/0.02/60,
  one terracotta accent (hue 40, from `palette.mjs --hue 40`), accent-deep 0.48/0.15/40 for
  normal-size accent text. Radius 0/2px; depth = hairlines + double rules only, zero shadows;
  motion = one language (underline grows / button fill), 160ms decelerate.

## Verified (script output on the delivered file)

- `contrast.mjs --pairs pairs.json` → **12/12 pairs pass AA** (body 16.11:1, secondary 6.94:1,
  accent text 6.25:1, stamp 6.75:1, tag 6.02:1, accent UI 4.46:1 ≥ 3:1).
- `slop-check.mjs index.html` → **0 fingerprint hits**.
- `audit-css.mjs index.html` → all declared pairs PASS · **TYPE PASS ratio 1.414 (inferred)** ·
  **SPACE PASS base 4**.
- `scale.mjs --type 11.31,16,22.62,32,45.25,64,90.5 --ratio 1.414` → PASS;
  `scale.mjs --space 8,16,24,32,48,64,96,128 --base 8` → PASS.
- Critique pass (modes/critique.md, static): found and fixed — dead `.btn--ghost` variant removed;
  nav labels reverted to conventional "Features/Pricing" (interaction-convention guardrail);
  `.tag` magic 2px padding → 0.25rem; Subtotal row added to the specimen; `overflow-x` guard on
  the specimen table; `text-wrap: balance` on h2s.
- Constraints: one file, embedded CSS, zero JS, zero external requests (system stacks; Fraunces /
  Fragment Mono declared as an install-note comment, not loaded). `prefers-reduced-motion`,
  skip link, landmarks, focus-visible, ≥24px targets, print stylesheet included.

## Remains assumption (not verified)

- **The visual loop did not run**: the sandbox Browser pane denied navigation (file:// and
  localhost both blocked), so rendered output — actual wrapping of the fluid ledger lines at
  intermediate widths, leader-dot alignment, stamp overlap — is judged from code only.
- System-font metrics vary per OS (Palatino vs Georgia fallback changes line lengths slightly).
- Copy claims ("paid ~9 days sooner", "27 currencies", prices) are plausible fiction for a
  fictional product, not data.
- Neutrals intentionally carry two hue casts (paper 85, ink 60, hairline 70) as a two-material
  paper-vs-ink story — deliberate, but a reviewer could read it as drift.
- Single light theme only, deliberate (an invoice is paper); no dark palette shipped.
