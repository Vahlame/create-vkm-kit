# Mode: critique — judge an existing design

Input: screenshot(s), code, or a URL. If you receive only code and a renderer exists, render
first (`modes/visual-loop.md` § capability check) — finish can only be judged visually. Judging
code alone is a degraded mode; say so. When CSS/token files are available, run
`node scripts/audit-css.mjs <files>` first — it extracts declared color pairs (resolving
`var()` chains), font sizes and spacing values, and checks them mechanically; your judgment then
starts from measured findings instead of impressions. Its scope is static (no inheritance, no
rendering) — it feeds the critique, it doesn't replace it.

## Inferring the incumbent direction (edits inside an existing design)

Most real tasks land inside someone's system. Before judging or editing, reconstruct the
direction the codebase already implies — never invent a second one:

1. **Tokens:** read the theme/token file (or `audit-css.mjs` output): base unit, radius values,
   shadow style, neutral temperature.
2. **Type:** collect the families and sizes; `scripts/scale.mjs --type <sizes>` names the ratio.
3. **Name the closest lineage capsule** (`references/lineages.md`) in one line — "this is a
   humanist-minimal system, base 8, radius 8, ratio 1.2" — and state it in the deliverable.
4. Critique against THAT direction (its rules, not your taste), and derive any edit from it.
   If the system is incoherent (three radii, two accent hues, no scale), the incoherence itself
   is the first Major finding — propose the reconstruction, don't silently pick a side.

Order findings by severity. Every finding needs **evidence** (a measured value where computable, a
location always) and a **concrete fix** — "improve spacing" is not a finding.

## Blockers — broken for someone

- Contrast below gate, COMPUTED (`scripts/contrast.mjs` on sampled fg/bg pairs, per theme):
  normal text < 4.5:1 · large text or UI < 3:1.
- Keyboard-only walk fails: unreachable control, invisible focus, focus trap, broken tab order.
- Missing screen states: empty, error, or loading absent by design.
- State encoded by color alone (error = red border only, selection = tint only).
- Layout breaks at the declared minimum width or at 200% zoom; text truncated with no recovery.
- Touch/click target < 24×24px CSS without compensating spacing.

## Major — undermines the design's job

- Hierarchy failure: squint test finds no clear first element, or the wrong one (see
  `references/designer-mind.md` crit vocabulary).
- Spacing incoherence: gaps off any scale (measure them — `scripts/scale.mjs --space` on the
  sampled values), proximity contradicting grouping, near-miss alignments.
- Slop fingerprint hits (`references/direction.md` list) — run
  `node scripts/slop-check.mjs <files>` for the text-detectable markers, then judge the
  composition-level ones (centered hero, 3-card grid) by eye; name each hit found.
- **No memorable move in the first viewport** (`references/contemporary.md` lineup test: logo
  hidden, indistinguishable from ten templates) — a gate-passing page with zero moves is a
  Major finding, not a pass; cite which current or lineage move would fix it.
- **A bespoke figurative drawing (species/product/landmark/mascot) that wasn't verified against
  a real reference — or that is visibly wrong for its subject** — is a Major finding
  (`references/illustration.md`). Name the wrong feature ("guapote drawn with a forked tail and
  fusiform body — that's a tuna; the cichlid has a rounded tail and a deep body").
- Type crimes: > 2 families, synthesized bold/italic, body measure outside 45–75ch, ad-hoc sizes
  off any scale, proportional figures in data tables.
- Inconsistent components: 3 button treatments, drifting radii/shadows, mixed icon sets.

## Minor — erodes finish

- Optical misalignment (metrically centered icons/glyphs that look off).
- Depth-system mixing (shadows + hairlines + surface shifts at random).
- Motion without purpose, durations > 500ms, missing `prefers-reduced-motion` handling.
- Widows/orphans in display text; unbalanced headline wraps.
- Neutrals in pure gray while the brand has a temperature; drifting hue casts between surfaces.

## Taste — direction level

- No discernible direction/lineage; or direction present but choices not derivable from it.
- Novelty budget misspent (five loud ideas competing) or unspent (competent but anonymous).
- Missed signature: nothing a user would remember.

## Output format

1. Verdict in two sentences (including the genericity call).
2. Findings by severity, each: `[severity] location — evidence → fix`.
3. The **top 3 highest-leverage changes** — often one token-level fix (scale, palette) that
   resolves a dozen symptoms downstream.

When the input came with a committed direction (from generate mode), critique **against that
direction**; when it came without one, the absence of direction is itself the first Major finding.
