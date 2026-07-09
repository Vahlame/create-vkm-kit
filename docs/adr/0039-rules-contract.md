# ADR-0039: RULES contract — dated, sourced, reasoned project rules

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** maintainer

## Context

The managed block already told agents to verify that a file quoted in a note
still exists ("memory goes stale") and the close ritual already named
`RULES/<project>.md` as a write target — but the kit said nothing about **what
makes a project rule trustworthy over time**, and the scaffold created no
`RULES/` home at all.

An external multi-agent bench run against this memory pattern (sop-suite
RUN1–RUN7, 2026-07-08: 4→10 trapped tasks × solo/+SOP/+SOP+memory conditions,
blind judges with frozen rubrics, fully mechanical grading in v2) measured
where vault memory actually pays:

1. **Memory pays on project rules invisible from the repo** (an immutable
   dispatch log, GitOps-only infra, a WCAG-AA contract, a VCRUNTIME packaging
   gotcha): +2–3 points per task. It adds ~nothing where the method/SOP
   already covers the domain (C−B ≈ 0 — H3 confirmed).
2. **Rules with recorded history were respected and cited** by subjects; bare
   rules were easier to drop or obey wrong.
3. **An aged-memory trap caught 0/7 subjects** — every model contrasted the
   planted stale rule against the nearby README/data before obeying, and
   several proved obeying it would have deleted real customers. But they left
   "update the team memory" as a _derived task_ — the wrong note survives
   unless fixing it is doctrine.

The report's recommendations for the vault: date each rule
(`last_verified`) and link it to its source so agents can self-verify; store
project rules, not method; give each rule its why; and fix a note that
contradicts the repo in the moment.

## Decision

1. **Scaffold.** `scaffoldNewVault` now creates `RULES/` with a bilingual
   `TEMPLATE.md`: every rule carries a **why** (concrete story or reason), a
   **source** (the file/test/ADR that defines or enforces it) and
   `last_verified: YYYY-MM-DD`, plus a `## Changes` `[decision]` trail for
   rule additions/retirements.
2. **Doctrine.** One paragraph added to the managed block's "Qué guardar /
   What to save" section: `RULES/` = project rules, not method (only what is
   invisible from the repo), each with why + source + `last_verified`;
   re-verify a rule against its source when using it; a note that contradicts
   the repo gets fixed **in the same session**.
3. **Gates updated as a reviewed decision (ADR-0036).** Budgets raised
   es 8,400 → 9,100 / en 8,200 → 8,850 chars (measured 8,660 es / 8,421 en
   after the addition — ~5% headroom restored; the pre-change block already
   sat at 8,386/8,139 after ADR-0038 growth). Two new load-bearing phrases
   pinned per language ("corrígela en la misma sesión" + "RULES/TEMPLATE.md";
   "fix it in the same session" + "RULES/TEMPLATE.md"). All drift surfaces
   regenerated (AGENTS.md, docs ES/EN install pages).

## Alternatives considered

- **Trimming elsewhere to fit the old budget:** rejected — the block is
  post-ADR-0036 diet; what remains is load-bearing, and the budget gate
  exists to make growth a _reviewed_ decision, not to freeze the block.
- **Shipping only the vault template, no doctrine line:** rejected — the
  bench showed the failure mode is behavioral (agents flag the stale note as
  someone else's task); a template alone doesn't assign the fix-in-session
  duty.
- **A hook enforcing rule metadata:** rejected as over-engineering — RULES/
  notes are user-curated; scaffold + doctrine nudge matches the kit's
  coach-don't-impose stance.

## Consequences

- Positive: new vaults start with an actionable rules format; agents get an
  explicit basis for trusting or re-verifying a rule; stale-note repair
  becomes the current agent's duty; budget growth is justified with numbers.
- Negative: +~270 chars (≈65–70 tokens) per language, paid per session by
  every wired agent.
- Neutral: existing vaults don't get `TEMPLATE.md` retroactively (the
  scaffold only runs on new vaults); existing installs pick the new block up
  on the next `create-obsidian-memory` run (replace-between-sentinels is
  idempotent).

## References

- ADR-0036 (budget / load-bearing / drift gates), ADR-0038 (evolutive memory
  loop — the levers this contract complements on the write side).
- External evidence: sop-suite bench, private repo `Vahlame/sop-suite`,
  `bench/informes/REPORTE-UTILIDAD.md` §4 (recommendations) and §RUN6
  (aged-memory trap 0/7; "update the team memory" left as derived task).
