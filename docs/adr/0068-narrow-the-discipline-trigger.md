# ADR-0068: Narrow the `vkm-discipline` trigger, and make "deliver more" conditional

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

`vkm-discipline` advertised itself as firing on **"any non-trivial task — coding,
debugging, data, infra, writing, review."** That sentence is why the skill reaches
explanation, non-technical writing, summarisation and decisions that are the user's
to make — task types where its own contract is actively wrong:

- _"Deliver more than asked, never less"_ is scope inflation when the user fenced the
  scope on purpose.
- _"No 'two approaches'… Pick the best path"_ directly contradicts a user who asked
  for two approaches with tradeoffs.

ADR-0067 put an arbitration rule in the always-on `core` level that outranks both.
That settles precedence, but it leaves the skill still **firing** on those tasks and
paying the arbitration cost every time. The trigger itself had to narrow.

## Decision

Replace the frontmatter `description` with a noun-anchored scope plus explicit
negatives (298 chars, under the existing 300-char cap in
`skills-install.test.mjs`):

> Execution discipline for code and its copy, debugging, data, infra, PR review,
> postmortem/README. Reads intent, scales depth to stakes, ends in executed evidence.
> NOT one-line edits (typo, rename, bump), questions, explainers, chat/log recaps,
> diagrams, web research, or options/scope the user set.

Three supporting changes:

1. **"Deliver more than asked" becomes conditional** on the user not having scoped the
   request, and defers explicitly to the arbitration rule. `Minimal friction` gains the
   matching clause: when they ask for approaches, give approaches.
2. **The domain table is documented as deliberately wider than the trigger.** Ten
   domain files stay reachable via explicit `/vkm-discipline` or via an in-scope task
   that also touches them. Reaching a domain file was never the trigger's job, and a
   trigger stretched to cover them is what caused this.
3. **Eight new bench negatives** (`neg2-01..08`), covering exactly what the narrowing
   must hold: an explicit request for two options where the user decides (×2, en/es), a
   deliberately fenced scope, a review whose correct outcome is "no changes needed",
   non-technical writing (×2), a line-by-line explainer, and an opinion request.
   `evals/skills-triggering/cases.jsonl` goes from 64 to 72 cases, `none` from 15 to 23.

### How the wording was chosen

Three candidate descriptions were drafted under different objectives — precision,
recall, and legibility to a small model reading ~40 descriptions — and each was then
attacked by two independent reviewers who classified all 64 existing cases under it
and reported predicted misses and false fires.

**All six verdicts came back `risky`.** No candidate survived intact, and the union of
their findings drove the final text:

- `hard-08` ("make the error messages in this CLI friendlier") was the unanimous #1
  predicted miss. Fixed by naming the artifact — _"code and its copy"_ — and by
  bounding the trivial-edit negative to a concrete list instead of the open category
  "typo/rename edits", which reviewers showed over-generalises to any wording change.
- Every candidate carried a head clause ("hands-on work on a real system", "multi-step
  code change") that its own positives contradicted, predicted to kill `disc-09`
  (postmortem) and `hard-09` (README). The head clause was deleted outright; a flat
  noun list has nothing left to contradict.
- Bare negatives "summaries"/"explanations" re-swallowed those same positives. Scoped
  to "chat/log recaps" and "explainers", which hit the intended cases by literal token.
- "the user's own call" was dropped as unroutable — an English-only idiom, ambiguous
  between "the user owns it" and "the user already decided", and a behavioural
  constraint the arbitration rule already enforces. Replaced with the matchable
  "options/scope the user reserved".
- "Multi-step" was rejected: unverifiable before the work, and it inverts the bench.

The description is validated as a plain YAML scalar (no `": "`, no leading indicator)
against both `yaml.safe_load` and the `^description: (.+)$` extractor `run.mjs` uses —
a description that broke either would disable the skill silently.

**The first draft was 316 chars and broke an existing gate**: `skills-install.test.mjs`
caps a skill description at 300, because it is always-in-context. Trimming to 298 was
done against an explicit list of the twenty tokens the reviewers tied to a specific
bench case (`code and its copy`→hard-08, `chat/log recaps`→hard-07/none-08,
`options`→neg2-01/08, …); every one of them survives. Two things were dropped, both
deliberately: `prose` from "postmortem/README prose" — its job was to contrast with
visuals, which the explicit `diagrams` negative already does — and `real` from "reads
real intent", a value claim that anchors no case. The em dash became "for" because
"discipline: " would have broken the plain scalar.

**One proposed bench case was discarded.** A ninth negative asked for "a paragraph on
blameless culture for our postmortem template" expecting `none`, while the existing
`disc-09` ("escribe el postmortem del incidente de ayer") expects `vkm-discipline`.
Both are postmortem prose. The intended distinction — an investigated incident versus
template boilerplate — is real but **not expressible in a description**, so the case
would have measured noise and punished the artifact for a distinction it cannot make.
Validate the instrument before trusting it (`METHODOLOGY.md` §2.1).

**Which edge of the control loop this closes:** ④ EXECUTE — doctrine now loads
just-in-time for the work it was written for, instead of as a permanent prior on work
it was not.

## Alternatives considered

- **Leave the trigger and rely on the arbitration rule.** Rejected: precedence resolves
  the conflict but still pays it on every off-scope task, and it only helps a model
  strong enough to apply a rule it read earlier — the exact dependency this programme
  is trying to remove.
- **Delete the conflicting lines from the skill body.** Rejected: "deliver more than
  asked" is genuinely right on an open-ended engineering ask, which is most of what the
  skill is for. The defect was that it was unconditional.
- **Split into two skills** (an engineering one and a writing one). Rejected for now:
  a second skill adds a permanent always-paid `description`, and there is no evidence
  yet that the writing case needs its own contract rather than a scoped trigger.
- **Keep "any non-trivial task" and add negatives only.** Rejected — reviewers showed
  the open positive dominates the negatives for weaker models, which are exactly the
  ones the negatives exist to help.

## Consequences

- Positive: the skill stops competing for explanation, summarisation, non-technical
  writing and user-owned decisions. The bench now has 8 cases that would catch a
  regression back to the old breadth.
- Positive: the two clauses that contradicted the rules block are conditional and name
  the rule that outranks them, so the three artifacts agree in writing.
- Negative: **this is a predicted improvement, not a measured one.** The reviewers'
  classifications are model judgements, not a run. `skills-triggering` must be re-run
  at more than one tier before any claim is made — three reviewers independently noted
  the failure mode is model-dependent clause anchoring, so a single-tier pass proves
  nothing. Until then this ADR records a hypothesis with a falsifiable prediction:
  the 12 `vkm-discipline` positives hold, and the 23 `none` cases rise.
- Neutral: a known structural limit of the bench, surfaced by the review and worth
  recording — `run.mjs` hardcodes a 4-skill listing, so it cannot see competition from
  the other skills live in a real session, which contest `disc-07`/`disc-09`/`hard-09`.

## References

- `packages/create-vkm-kit/templates/skills/vkm-discipline/SKILL.md`
- `evals/skills-triggering/cases.jsonl` (72 cases), `evals/skills-triggering/RESULTS.md`
- ADR-0067 (the arbitration rule this defers to), ADR-0064 (the reporting rule the
  re-run must be graded under)
