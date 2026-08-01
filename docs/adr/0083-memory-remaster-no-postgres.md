# ADR-0083: Memory remaster — no Postgres; model-epoch awareness instead

- **Status:** Accepted
- **Date:** 2026-08-01
- **Deciders:** maintainer

## Context

Two prompts from the user this kit serves:

1. "I heard Postgres (or something like it) could be integrated into the memory — what do
   you think?"
2. "As new models come out, what was tuned for opus 4.8 doesn't work as well on opus 5 —
   remaster the memory so it survives that."

Both deserve a recorded answer, because both will come up again.

## Decision 1 — Postgres/pgvector stays OUT of the memory path

The memory's value proposition is the **vault**: Markdown notes in a git repo — auditable,
portable, diffable, and the user's property. The **index** over it (SQLite: FTS5 +
optional `sqlite-vec` for the semantic scan, ADR-0025) is a disposable cache that any
machine rebuilds with one command. Swapping that for Postgres/pgvector would mean:

- **A server to install, run, secure and migrate** on every machine the vault lives on —
  against the kit's local-first, no-daemon-except-sync, localhost-only posture
  (ADR-0016/0040), and against the Windows-gamer profile the kit explicitly serves.
- **No measurable retrieval gain at vault scale.** A personal vault is 10²–10⁴ passages;
  the brute-force cosine scan is already milliseconds, and `sqlite-vec` accelerates it
  **ranking-identical** (ADR-0025, property-tested). pgvector's ANN indexes pay off at
  ~10⁵–10⁷ vectors — two to five orders of magnitude past the workload.
- **A second source of truth.** The moment notes live in a database, git stops being the
  audit trail and the sync daemon stops being sufficient.

When it WOULD be the right call — recorded so the next person asking finds the honest
boundary, not a dogma: a **multi-user shared** memory bank, **>100k passages**, or an org
that already operates managed Postgres and wants memory inside its existing backup/ACL
perimeter. Those are server-product requirements; this kit is a personal one. Revisit
then, not before.

## Decision 2 — model-epoch awareness (the actual remaster)

The aging problem is real but it is not storage — it is **model-specific memory**:
`_meta/agent-profiles.md` rows and `STACKS/` verdicts are written under one model and
silently mis-steer the next one. Two changes:

1. **The `SessionStart` hook detects the epoch change.** It already receives the model
   (the only hook that does). It now compares against `~/.vkm/last-model.json` and, only
   when the model differs from the previous session's, appends ONE context line naming
   both models and downgrading model-specific tunings to hypotheses to re-verify. Steady
   state costs zero: same model → no line, no write. Never throws; a missing model field
   records nothing and clobbers nothing.
2. **The profiles document their own expiry.** `_meta/agent-profiles.md` (templates and
   example) now carries a generation-maintenance rule: on the first session with a new
   model, re-read your row as a hypothesis, confirm or correct with a dated observation,
   prune generations no longer run.

This is the same shape as the rest of the kit's doctrine: a deterministic hook makes the
event visible, prose tells the model what to do about it, and the vault stays the single
source of truth.

## Consequences

- Positive: the "new model, stale tuning" failure gets a deterministic trigger instead of
  relying on someone remembering; the Postgres question has a recorded, criteria-based
  answer. No new dependencies, no new servers, ~0 steady-state token cost.
- Negative: the notice fires on ANY model change including deliberate one-off switches
  (e.g. a single haiku session) — accepted: it is one line, and a deliberate switch is
  exactly when stale tunings mislead most.
- Neutral: `~/.vkm/last-model.json` is a new tiny state file; unreadable/corrupt states
  self-heal on the next write.

## References

- ADR-0025 (sqlite-vec, ranking-identical), ADR-0016/0040 (local-first posture)
- `packages/create-vkm-kit/src/hooks/session-start-vault-context.mjs`
  (`modelChangeNotice`), `test/session-start-vault-context.test.mjs`
- `templates/vault/{es,en}/_meta/agent-profiles.md`, `examples/_meta/agent-profiles.md`
