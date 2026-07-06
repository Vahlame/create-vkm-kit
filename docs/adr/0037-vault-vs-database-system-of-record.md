# ADR-0037: The vault is a memory layer, not a system of record — transactions, concurrency, auth and audit stated honestly

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** maintainer

## Context

A recurring outside critique of the vault pattern goes: *"an Obsidian vault is flat markdown. No transactions, no concurrency control, no auth, no schema enforcement. Multiple processes writing at once = race conditions and corrupted state. A ticketing system needs an audit trail. Fine as a read-only knowledge layer for agents, but the system of record belongs in Postgres."*

The kit's docs already conceded pieces of this in passing (`docs/en/faq.md` "Markdown vs SQLite", `docs/en/how-it-works.md` "What it is not"), and prior ADRs rejected databases on *retrieval-scale* grounds (ADR-0014, ADR-0023, ADR-0025). But no ADR answered the critique's actual axes — ACID, concurrency, auth, audit — head-on. This one does, and records what the kit guarantees on each axis after the 2026-07 hardening work.

## Decision

**The vault is the agent-memory layer; business/product state belongs in a real database.** We keep Markdown + git as the source of truth for memory and make the guarantees explicit, per axis:

- **Transactions.** The contract is **per-note atomicity + optimistic concurrency**, not ACID. Every write is tmp+rename (a reader never sees a torn note). `vault_read_file` returns a content **etag**; `vault_write_file`/`vault_edit_file` accept `ifMatch` and fail with a retryable error if the note changed since the read — no lost updates across a read→think→write round-trip. There are deliberately **no cross-note transactions**: a memory layer tolerates a moment of inconsistency between two notes; a ledger doesn't — which is exactly why a ledger shouldn't live here.
- **Concurrency.** On one host, an **advisory write lock** (O_EXCL lockfile in the derived sidecar dir, dead-PID/TTL steal, same-host only) serializes the sidecar's read-check-write spans, and `vault_edit_file`'s must-match-exactly-once rule rejects edits against changed context. Across machines, coordination is git's: `pull --rebase`, conflicts **surfaced, never auto-merged** (ADR-0013 as amended), with `doctor` and `vault_audit` reporting conflict files, merge markers and stuck rebases. No distributed lock is attempted — that's a database feature, and wanting it is the signal to use one.
- **Auth.** None in-band, **by design**. The MCP is local stdio serving one user; authentication would be theater. The real boundaries are the filesystem ACL and the git remote's permissions (private repo, 2FA, branch protection) — see SECURITY.md. Multi-user, per-row authorization is precisely the "use Postgres" case.
- **Audit trail.** Git history, made useful: auto-commits carry the **staged-file list** and an optional **`Agent:` trailer** (`OBSIDIAN_MEMORY_AGENT`), so `git log` answers *what changed and which daemon committed it*. Honest limits: commits within a debounce window coalesce, attribution is per-daemon/machine (not per tool call), and history is **reviewable, not tamper-evident** (no signed commits). Compliance-grade audit belongs in a database with an append-only log.
- **Schema.** Opt-in required-keys validation via a committed `memory-schema.json` (warnings by default, `enforce: true` to reject), checked by the write path and `vault_audit`. Deliberately no types/enums/formats — richer constraints are the database's job.

## Alternatives considered

- **SQLite as the source of truth:** rejected — kills human reviewability in Obsidian/git diffs and contradicts ADR-0014's derived-only sidecar stance; the index must stay rebuildable and deletable.
- **Postgres sidecar for memory:** rejected — violates the zero-heavy-deps ethos (a daemonized DB server to remember preferences), and none of its wins (ACID across entities, in-band auth, row-level security) are needed by a single-user local memory layer.
- **Pretending the gaps don't exist:** rejected — the FAQ now says plainly when NOT to use the vault (ticketing systems, product backends, multi-tenant state), and this ADR is the architectural record of that boundary.

## Consequences

- Positive: the critique's fixable substance is fixed (lost updates, phantom merge claim, anonymous commits, invisible corruption); the rest is now a documented, deliberate boundary instead of an omission.
- Negative: `ifMatch` and the lock add a small failure mode ("precondition failed", "vault busy") that agents must handle by re-reading/retrying.
- Neutral: none of this changes default behavior for existing installs; every new guarantee is additive or opt-in.

## References

- ADR-0004 (sync order), ADR-0013 (as amended — conflicts surfaced, never merged), ADR-0014/0023/0025 (derived-only SQLite), ADR-0033 (self-paste guard), ADR-0038 (evolutive loop)
- `docs/en/sync.md` "Multiple agents writing to one vault", `docs/en/faq.md`, `SECURITY.md`
