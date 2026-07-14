# ADR-0053: `vkm-design` — a model-agnostic professional design skill

- **Status:** Accepted
- **Date:** 2026-07-12

## Context

LLMs converge on the statistical mode of their training data when asked to design: the same
indigo-gradient hero, the same Inter-on-everything, the same three-card grid — "AI slop". The kit
already ships `domains/design-ui.md` inside `/vkm-discipline`, but that file is an **acceptance
gate** (computed contrast, keyboard-only, screen states), not a generative method. Nothing in the
suite teaches an agent _how a trained designer thinks_, how to diverge from its own default, which
real libraries to style with across ecosystems, or how to iterate against a rendered screenshot.
The user's requirement: any medium (web, mobile, desktop, TUI, dataviz, brand), any model from any
lab, and effectiveness over size.

## Decision

Ship a third skill, `vkm-design`, in `packages/create-vkm-kit/templates/skills/`, installed via
the existing `SKILL_NAMES` list (`src/skills-install.mjs`) with hash-guarded asset management:

- **Progressive disclosure:** a lean `SKILL.md` router; depth lives in `references/`
  (designer-mind, direction, foundations, libraries) and `modes/` (generate, critique,
  visual-loop, handoff) loaded per task. Always-in-context cost stays one frontmatter description.
- **Designer cognition as the core:** `references/designer-mind.md` operationalizes how a trained
  designer thinks — Gestalt perception, hierarchy-first, process order (brief → precedents →
  constraints → concept → diverge → craft passes → crit), crit vocabulary, taste heuristics.
- **Anti-generic engine:** `references/direction.md` forces naming and banning the model's own
  default, offers direction axes, and carries an explicit banned-by-default "slop fingerprint".
- **Real libraries, unversioned:** `references/libraries.md` maps categories/candidates across
  web, mobile, desktop, TUI and dataviz with a hard verify-online-at-use-time rule — the map
  doesn't rot, versions come from the web at the moment of use.
- **Computed checks:** zero-dependency Node validators (`scripts/contrast.mjs` — WCAG ratios,
  batch over token pairs; `scripts/scale.mjs` — modular type scale + spacing rhythm) with CLI
  exit codes, unit-tested in the `create-vkm-kit` suite. No shell → the formulas are inline in
  `foundations.md`.
- **Gate/method separation:** `domains/design-ui.md` stays the acceptance gate and gains a
  pointer to the skill; the skill treats the gate as its definition of done. No rules duplicated.

## Alternatives considered

- **Expand `domains/design-ui.md`.** Bloats a deliberately cheap checklist loaded by a different
  skill's router; method and gate have different load profiles.
- **Per-harness adapters** (Claude Code / Cursor / Codex variants). Maximum integration, N×
  maintenance; plain markdown + Node scripts already run everywhere the kit installs.
- **Pinned library versions in the skill.** Precise on day one, wrong by month three; the
  verify-online rule moves versioning to use-time where it can't rot.

## Consequences

- **Positive:** any agent that can read markdown gets the method; any agent with a shell gets
  computed evidence; any agent with a renderer gets the visual loop. Degradation is explicit at
  each step.
- **Positive:** the existing installer tests cover the new skill automatically (`SKILL_NAMES`
  iteration + description cap + nested-asset assertions).
- **Negative:** the skill is the largest asset in `templates/skills/` (~10 files). Accepted:
  progressive disclosure keeps per-session cost flat, and the user explicitly traded size for
  effectiveness.
- Runnable scripts inside an installed skill continue the packages-era practice that superseded
  ADR-0006's prompt-only distribution (scripts are installed assets, not clone-and-run).

## References

- `packages/create-vkm-kit/templates/skills/vkm-design/`
- `packages/create-vkm-kit/src/skills-install.mjs`, `test/vkm-design-scripts.test.mjs`
- ADR-0049 (skills channel), ADR-0006 (legacy distribution model).
