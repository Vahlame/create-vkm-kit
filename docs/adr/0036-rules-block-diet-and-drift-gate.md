# ADR-0036: Rules-block diet + sync turned into a build gate

- **Status:** Accepted
- **Date:** 2026-07-03
- **Deciders:** maintainer

## Context

After ADR-0034 (per-call cost) and ADR-0035 (schemas + hook), the single
largest remaining fixed cost was the **managed rules block** the installer
writes into `~/.claude/CLAUDE.md` / Cursor User Rules: **9,746 chars ES /
9,484 EN (~2,400 tokens)** paid in every session of every project by every
wired agent.

Auditing it against the post-ADR-0035 kit found two problems:

1. **Redundancy that no longer pays.** Passage-first discipline was stated in
   five places; the "which tool to use" section re-taught, in long form, what
   every tool's own description now teaches each session (ADR-0035 made
   schemas the canonical teaching surface); provenance prose (caveman/
   ponytail history) documents the past, not behaviour.
2. **Silent drift.** The docs install pages (`docs/{es,en}` Step 4) embedded a
   _different, older_ variant of the block — "kept in sync" only by a source
   comment. Cursor users copy-pasting from docs got different rules than the
   installer wrote. Worse: the docs variant contained two good rules the
   canonical block never had ("if no vault MCP responds, **never claim to
   have persisted**"; "`memory://…` resources are IDE memory, not the vault").

## Decision

1. **Compress the block, drop zero rules.** Cut repetition, the long tool
   catalogue (now a one-sentence map deferring to tool descriptions),
   provenance prose, and installer-internal detail. The Trust section is
   byte-identical. **Rescue the two docs-only rules into the canonical
   block.** Result: **ES 9,746 → 7,979 chars (−18.1%), EN 9,484 → 7,743
   (−18.4%)** — ~440 tokens saved per session per project _with two more
   rules than before_.
2. **Three build gates** (`memory-rules-budget.test.mjs`):
   - **Budget:** ES ≤ 8,400 / EN ≤ 8,200 chars (~5% headroom) — growth is a
     reviewed decision.
   - **Load-bearing rules:** 13 phrases per language (security, precedence,
     close ritual, honesty, discipline) must survive any future trim —
     over-compression fails the build before a user feels it.
   - **Drift:** AGENTS.md must embed the sentinel block verbatim and both
     docs install pages must embed the body verbatim. The sync comment is now
     an assertion.
3. All four downstream copies regenerated from the canonical source
   (AGENTS.md, docs ES/EN, and the reference machine's installed
   `~/.claude/CLAUDE.md`); the docs' stale extra section ("Estilo de notas",
   duplicated by "Qué guardar") removed.

## Alternatives considered

- **Trimming the Trust section or the close ritual:** rejected — security and
  ordered multi-step sequences are exempt from compression by the kit's own
  discipline rules; the load-bearing gate now enforces that exemption.
- **Dropping the "which tool to use" map entirely** (schemas teach it):
  rejected — Cursor/Codex sessions may run with the basic-memory MCP only,
  where the hybrid tool descriptions aren't present; a one-sentence map is
  the right floor.
- **Generating the docs install pages from memory-rules.mjs at build time:**
  deferred — the drift _gate_ delivers the correctness guarantee without a
  codegen step; revisit if the block starts changing often.

## Consequences

- Positive: ~440 tokens/session/project saved on top of ADR-0035's ~865;
  Cursor copy-paste users now get exactly what the installer writes; two
  honesty/anti-confusion rules are now universal; any future bloat, rule
  loss, or drift fails CI.
- Negative: agents lose the long-form knob explanations in the block — they
  keep them in the tool schemas, which every hybrid-wired session already
  receives; basic-memory-only sessions keep the short map.
- Neutral: existing installs pick the new block up on the next
  `create-obsidian-memory` run (replace-between-sentinels is idempotent).

## References

- ADR-0032 (block's origin), ADR-0034/0035 (the other two cost axes),
  ADR-0029/0030 (precedence doctrine the block enforces).
- Measurements: block ES 9,746 → 7,979 / EN 9,484 → 7,743 chars; docs
  variant drift discovered while syncing (extra Confianza bullet + two
  rescued rules).
