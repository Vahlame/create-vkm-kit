# ADR-0067: Split the rules block into core / memory / doctrine

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

The installed rules block is 9,375 chars (es) injected into every session of every
wired agent, in every project, forever. ADR-0036 gated its size. Nothing ever gated
its **composition** — and composition is the part that matters, because the block is
not a cost, it is a **permanent behavioural prior**. It applies to work the kit was
never designed for as forcefully as to the work it was.

Reading it as one artifact, three of its sections are memory protocol and five are
not. `Auto-cuestiónate`, `Acompaña no impongas`, `Memoria evolutiva`, `Conoce tu
modelo` and `Mantenlo barato` are general working style. They may well be good
advice. They are also unconditional instructions about how to answer _anything_,
shipped to a user who installed a memory tool.

Worse, the block contradicted itself and the skills. `vkm-discipline` triggers on
"any non-trivial task — coding, debugging, data, infra, writing, review" and says
_"Deliver more than asked"_ and _"No 'two approaches'… Pick the best path"_; the
block said _"pide confirmación"_, _"Muestra los candidatos y espera"_ and _"Nunca
impongas"_. Three resident priors, no stated precedence, and the arbitration cost
paid silently on every task.

There was no way to turn any of it off, and therefore no way to find out what it does.

## Decision

Three levels, selected by `--rules-profile minimal | standard | full`:

| Level      | In profiles    | Budget (es/en)            | Membership test                                        |
| ---------- | -------------- | ------------------------- | ------------------------------------------------------ |
| `core`     | all            | 1,181 / 1,165 (cap 1,200) | does its absence make the kit **unsafe or dishonest**? |
| `memory`   | standard, full | 4,593 / 4,482             | is it the memory protocol itself?                      |
| `doctrine` | full only      | 3,141 / 2,967             | general working style                                  |

`core` carries memory precedence, the untrusted-data boundary, "if no MCP answers,
say so, never claim to have persisted" — and a new **arbitration rule** that did not
exist anywhere before:

1. The user's preferences and the current chat beat any rule here, in a skill, or in
   the vault. Ask for two approaches and you get two approaches.
2. Brevity belongs to the prose, never to the work: never simplify away input
   validation, error handling that prevents data loss, or security.
3. Low stakes → decide and proceed. Medium or high stakes → ask before assuming.

Rule 3 is what resolves the conflict rather than papering over it. "Deliver more than
asked" and "ask first" were never actually opposed — they are the same rule at
different stakes, and nothing had ever said so. Rule 2 does the same for terseness
versus quality: the compression target is the prose, and it never was the code.

**Default stays `full`.** The kit's advertised default is the full stack; quietly
shipping less doctrine than the docs describe would be its own kind of drift.
`minimal` is the documented **kill switch** — 1,487 chars against 9,225, an 84%
smaller permanent prior — for when the kit's style is getting in the way.

Per-level budgets replace the single one, and load-bearing rules are now pinned **to
a level**. That closes the failure mode this refactor could most easily have
introduced: a safety rule quietly demoting from always-on to opt-in.

**One rule moved, deliberately.** `Nunca simplifiques` / `never simplify away` lived
inside the terseness section. It is a safety rule about validation, data loss and
security, so it moved to `core` — otherwise "turn off the style guidance" would have
silently meant "turn off the rule protecting correctness". Its caveat `no comprimas` /
`don't compress` stayed with the terseness rule in `doctrine`, where it is meaningless
without its parent.

**Which edge of the control loop this closes:** ② DOSE — the first real one. Dosing is
still manual (a flag, not a per-session decision), but for the first time there is
something to dose.

## Alternatives considered

- **Make `minimal` the default.** Rejected on the maintainer's explicit call: the
  advertised default is the full stack, and `minimal` never becomes the default even
  if it wins off-target. It stays a documented escape hatch.
- **Delete `doctrine` outright.** Rejected — it is unmeasured, not disproven, and the
  anti-objective is explicit: don't remove functionality for lacking a measurement,
  measure it and decide with the number.
- **Move `doctrine` into the skills that need it.** Still the likely end state, and
  a better one, but it changes skill behaviour and needs its own before/after. This
  ADR only makes the level separable, which is the precondition.
- **Reword the conflicting rules to agree.** Rejected: the conflict is structural
  (three artifacts with independent triggers), so prose harmonisation would drift
  apart again. An explicit precedence rule in the always-on level survives edits to
  any single artifact.
- **A per-section opt-out (`--no-terseness`, …).** Rejected: a combinatorial surface
  nobody would test, for a distinction three levels already capture.

## Consequences

- Positive: "is the fixed layer harmless on tasks the kit does not optimise for?"
  becomes answerable — the arms exist. Running the same off-target tasks across
  `minimal` / `standard` / `full` is now a dose-response curve, not a yes/no.
- Positive: the arbitration rule ends the silent three-way conflict, and it lives in
  the level nobody can opt out of.
- Positive: the kill switch is real and documented, at 16% of the default's size.
- Negative: three surfaces (AGENTS.md, both install docs) must be regenerated when
  any level changes. The drift gates already catch it, and now they catch it per level.
- Neutral: the default install's block is 9,225 chars against 9,375 before — this is
  a regrouping, not a diet. The diet, if any, is what the measurement decides.

## References

- `packages/create-vkm-kit/src/memory-rules.mjs`,
  `packages/create-vkm-kit/test/memory-rules-budget.test.mjs`
- ADR-0036 (the single-budget gate this re-cuts), ADR-0063 (the fixed-layer inventory
  that put a number on what is being split)
- `packages/create-vkm-kit/templates/skills/vkm-discipline/SKILL.md:20-23` (the
  conflicting doctrine the arbitration rule now outranks)
