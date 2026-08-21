# ADR-0090: Live precedents over closed menus; measured layout in ui-judge

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** maintainer
- **Amends:** [ADR-0053](./0053-vkm-design-skill.md)

## Context

ADR-0053 shipped `/vkm-design` to stop indigo/Inter/three-card slop: name the default, ban it,
sample lineages and contemporary "moves", compute contrast, loop on screenshots. Field use
showed a second failure the first protocol cannot see:

1. **Closed-menu homogenization.** Once indigo is priced, agents sample _this skill's own
   files_ — Fraunces on warm paper, dark-luxe gold, a CSS grain overlay, a giant cropped
   wordmark — and every harness (Claude, Cursor, Codex, Kimi, local weights) ships the same
   page in a new tint. Ban lists do not generate variety; they move the mode one step over
   (observed independently in 2025–2026 vibe-coding write-ups, and in arXiv:2603.13036 on
   design homogenization). Geist and Tailwind `blue-500` (`#3b82f6`) are that next mode.
2. **Unmeasured space.** `/vkm-ui-judge` audited contrast, overflow, tap targets and images.
   Pages passed while text kissed the viewport, cards had 4px padding, sections sat 2px
   apart, and three buttons disagreed on size. Users reported "it doesn't respect the
   margin, it doesn't leave space, it doesn't follow components." Those are rectangles, not
   taste — but nothing measured them, so the visual loop declared victory on WCAG alone.

The skill already _said_ it had no house style. Saying it does not stop a model from
ordering from `lineages.md` / `contemporary.md` / the worked example.

## Decision

1. **Live dossier is a Surface-tier gate.** Generate mode shows three live URLs (or named
   physical artifacts) for _this brief_ — stolen technique, spacing attitude, reject —
   before any direction is named (`references/inspiration.md`). Direction axes cite a
   dossier line. `lineages.md` capsules are **grammar** (density, shape, motion), not
   costumes: type lists and OKLCH seeds are not copied unless a live page uses them.
   `contemporary.md` and `craft-tech.md` are **decoders** of what was seen on those URLs,
   not menus to order from. No web → write `NO LIVE LOOKUP` and still may not copy capsules
   as costume.
2. **Layout is a measured gate in `/vkm-ui-judge`.** `scripts/layout-checks.mjs` (pure,
   unit-tested) scores viewport inset, card padding, content overlap, component drift and
   cramped stacks from a first-viewport box dump. `ui-audit.mjs` merges those findings with
   contrast/overflow, writes `geometry.json`, and the visual loop / critique rubric treat
   `edge-flush` / `overlap` as blockers and the rest as majors. Floors follow Material 3
   compact/medium margins (16 / 24 CSS px) as the _default_ for product UI; an earned
   full-bleed crop (box hanging _past_ the viewport) is exempt.
3. **Second-default slop is priced.** `slop-check.mjs` flags Geist/Roboto as `font-default`
   and Tailwind blue-500's OKLCH band (`tailwind-blue`) the same way it already flags
   Inter/indigo — banned as a default, legal with one brief-justified line.

The division of labor is unchanged: design skill = method + source audit; ui-judge =
rendered defects, now including space.

## Alternatives considered

- **Longer ban lists and more lineage capsules.** Grows the closed menu; the next statistical
  mode becomes the house style. Rejected.
- **Vision-only spacing critique** ("look at the screenshot and leave more margin"). That is
  what already failed: models skip it or "see" air that is not there. Rectangles first.
- **Per-harness design skills** (Cursor vs Claude vs local). The homogenization is the shared
  corpus plus the shared skill menu, not the chrome. One protocol, every install root.

## Consequences

- **Positive:** variety is generated from the world (this brief's job), not from a 17×14
  internal picker; spacing defects become fail-the-audit instead of a taste note.
- **Negative:** Surface-tier generate spends a web round-trip before pixels. Accepted — that
  round-trip is cheaper than another identical landing page. Offline work degrades honestly.
- **Neutral:** design-bench mechanical scores on historical HTML samples are unchanged except
  where a sample used Geist/Roboto/`#3b82f6` (none of the committed Cabinet files do).

## References

- `packages/create-vkm-kit/templates/skills/vkm-design/references/inspiration.md`
- `packages/create-vkm-kit/templates/skills/vkm-design/references/craft-tech.md`
- `packages/create-vkm-kit/templates/skills/vkm-ui-judge/scripts/layout-checks.mjs`
- [ADR-0053](./0053-vkm-design-skill.md)
