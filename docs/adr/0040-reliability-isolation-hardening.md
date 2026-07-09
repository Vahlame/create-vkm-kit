# ADR-0040: reliability + isolation hardening across daemon, MCP wire, and retrieval scoring

- **Status:** Accepted
- **Date:** 2026-07-09
- **Deciders:** maintainer

## Context

A fresh four-way audit of the kit (Go daemon, Node MCP sidecar, Python RAG
engine, installer/hooks) against the current code (v3.15.0) — done because the
kit had gone through several rounds of hardening already (ADR-0029→0039) but
had never had a pass specifically looking for silent-failure and
cross-boundary-trust gaps rather than token cost or retrieval quality. It
re-verified a backlog of 6 gaps a prior audit (2026-07-01, recorded in
`PROJECTS/cursor-obsidian-memory-guide.md`) had explicitly deferred, and found
16 new issues. Several fixes are pure bug fixes (see `CHANGELOG.md`
`[Unreleased]` for the full list) and don't need an ADR. This one records the
decisions that introduce a new mechanism or change an existing security/design
boundary.

## Decision

1. **Cross-process lock for the Go daemon's git-sync (`cmd/obsidian-memoryd/lock.go`).**
   `syncMu` only ever guarded one process; two daemon instances (or a daemon
   plus a manual `sync once`/git operation) pointed at the same vault could
   interleave `add`/`commit`/`pull`/`push`. Added an O_EXCL lockfile under the
   vault's `.obsidian-memory-rag/` sidecar dir carrying `{pid, hostname,
acquired_at}`, mirroring the MCP sidecar's advisory lock
   (`vault-lock.mjs`) but **fail-fast** instead of blocking-with-backoff: a
   live holder returns immediately (the next debounced watch cycle retries),
   there is nothing to gain by blocking a goroutine. Staleness is same-host
   dead-PID **or** a 10-minute TTL backstop; a foreign-host lock is **never**
   stolen regardless of age, because Syncthing (ADR-0013) can replicate this
   file from a daemon still running on another machine — stealing it there
   means two hosts writing the working tree at once.

2. **RAG-passthrough MCP tools no longer accept a caller-supplied `vault` path.**
   `vault_hybrid_search`/`vault_fts_search`/`vault_fts_index`/`vault_complete`/
   `vault_relations`/`vault_observations`/`vault_kg_suggest`/
   `memory_extract_candidates`/`vault_audit`/`vault_memory_report` all exposed
   an optional `vault: z.string()` in their wire schema with **zero**
   validation against the configured default — unlike the filesystem tools
   (`vault_read_file`/`write_file`/`edit_file`/`list_directory`), which never
   exposed the param at all and are additionally containment-checked by
   `safeVaultPath()`. This was a real read oracle: a note whose content
   coerces an agent into passing `vault: "C:\Other\Directory"` got that
   directory's `.md` files indexed and searched, with matches returned into
   the conversation — plus a write side effect (a `.obsidian-memory-rag/`
   index dir created in the attacker-chosen path). Checked the repo for an
   intentional multi-vault-per-call feature and found none — this kit's
   documented multi-vault pattern is a **separate MCP server process per
   vault** (its own `BASIC_MEMORY_HOME`), not a runtime parameter. Removed the
   `vault` field from all 10 tool schemas, matching the fs-tools posture.
   `requireVault(vaultArg)` itself is untouched internally for direct/test
   callers — only the MCP wire surface is locked down.

3. **Claude Code hook commands switched from an interpolated string to exec form.**
   `hookCommand`/`guardHookCommand`/`stopHookCommand`/`effortGateHookCommand`
   built `node "<hook>" "<vault>" <lang>` by naive string interpolation with
   no escaping — reproduced: a vault path containing `"` or a trailing `\`
   before the closing quote corrupted the generated command. Claude Code's
   hook config supports `{command, args: [...]}` (no shell involved), so this
   is eliminated at the root rather than patched with an escaping helper: all
   four builders now return an argv array.

4. **Installer gained real hook removal, not just additive install.**
   `--no-memory-enforcement`/`--no-effort-gate`/`--no-native-memory-override`
   only ever gated whether to _add_ hook entries — a user turning a flag off
   after a prior full install stayed gated forever, silently, with no
   uninstall path at all. Added symmetric removal
   (`removeSessionStartHook`/`removeEnforcementHooks`/`removeEffortGateHook`)
   keyed on this kit's own hook-command signature (never touches a user's own
   unrelated hooks) plus a real `--uninstall` flag that also deletes the 4
   hook script files, gated by an ownership marker so a user's same-named file
   is never deleted.

5. **Hook transcript scans became incremental.** `guard-effort-gate.mjs` and
   `stop-vault-close-reminder.mjs` re-read and re-parsed the **entire**
   transcript JSONL on every gated event (ADR-0030/0031 explicitly deferred
   this as "zero extra state to manage" for v1) — measured ~75ms on a real
   25.8MB transcript, paid on every substantive edit in a session, i.e.
   worsening within the session as the transcript grows. Since these hooks
   run as a fresh subprocess per call (no persistent process to cache in),
   added a small sidecar cache file per (transcript, hook) pair storing the
   last-consumed byte offset plus the folded derived state, so each call only
   scans the new suffix. Falls back to a full rescan on any doubt (missing
   cache, shrunk/replaced transcript) — correctness over speed.

6. **Backup files get real Windows ACL protection, not a skipped no-op.**
   `atomicWriteJson` and the settings/mcp.json backup paths guarded `chmod
0o600` with `if (process.platform !== "win32")` — meaning the protection
   the code's own comments describe (these files can carry tokens) never
   applied on Windows, the platform this repo's maintainer actually runs on.
   Added `restrictFileToOwner()` (`file-perms.mjs`), which shells out to
   `icacls <file> /inheritance:r /grant:r "<user>:F"` on Windows (best-effort,
   non-fatal — ACL manipulation can be fragile across configurations) and
   keeps the existing `chmod 0600` elsewhere.

7. **Usage-boost retrieval scoring now decays by recency of use, not just presence in a window.**
   The ADR-0038 `usage` lever multiplied fused RRF score by
   `1 + 0.15·log1p(uses)/log1p(max_uses)`, where a use counted fully anywhere
   inside `USAGE_WINDOW_DAYS=90` and not at all outside it — a cliff, not a
   taper. Among two candidates of otherwise-equal relevance, an old note used
   89 days ago kept the **same** credit as one used yesterday, while a
   brand-new note always started at the floor. That's the opposite of
   ADR-0038's stated goal ("a decision recorded last week should outrank a
   year-old one") whenever `usage` is on without also enabling the independent
   `recency` lever. Added `usage_counts_decayed()`: each use is weighted by
   linear recency decay (`1.0` at age 0 → `0.0` at the window edge) before
   summing into the same `log1p` normalization. The raw `usage_counts()` stays
   for its own contract/tests; this is a sibling, not a replacement.

8. **`ensure_fresh` prefers the embedder identity already on disk over the env/default resolution.**
   Every RAG CLI subcommand except `hybrid-search`/`index --semantic` called
   `ensure_fresh(vault)` with no explicit `--embedder`, resolving via
   `get_embedder(None)` independent of whichever embedder actually built the
   existing vector index. A user who built the index once with a specific
   embedder but never permanently exported `OBSIDIAN_MEMORY_EMBEDDER` got a
   second, redundant index silently built and maintained on every later bare
   call. `ensure_fresh` now reuses the on-disk identity when the caller passed
   no explicit override; an explicit `--embedder` still always wins.

## Alternatives considered

- **Item 2 — allowlist env var instead of removing the param:** considered
  (`OBSIDIAN_MEMORY_ALLOWED_VAULTS`) but rejected once no evidence of an
  intentional per-call multi-vault feature turned up; removing the param
  matches the fs-tools posture exactly and is strictly simpler to reason
  about than an allowlist someone has to remember to configure correctly.
- **Item 1 — blocking-with-backoff cross-process lock (matching the MCP sidecar's lock):** rejected for the daemon specifically — a background sync loop that retries every debounce cycle anyway gains nothing from blocking a goroutine, and fail-fast keeps a wedged lock from stalling the whole watch loop.
- **Item 5 — persistent daemon process for the hooks instead of a sidecar cache file:** rejected as a much larger architectural change (these hooks are intentionally stateless subprocesses per Claude Code's hook model); an incremental-offset cache gets most of the win without it.
- **Item 6 — skip Windows protection, document as accepted risk:** considered as the fallback if `icacls` proved too fragile; not needed once a simple best-effort, non-fatal shell-out worked cleanly in testing.

## Consequences

- Positive: a coerced/prompt-injected `vault` argument can no longer redirect
  RAG tools outside the configured vault; two daemon processes (or a daemon +
  manual git op) can no longer race the working tree; hook commands survive
  vault paths with quotes/backslashes; turning off an enforcement flag (or
  running `--uninstall`) actually removes what was installed; long sessions no
  longer pay O(n) hook overhead per edit; a week-old decision note is no
  longer permanently outranked by a stale-but-technically-in-window popular
  note; redundant vector indexes stop appearing silently.
- Negative: the MCP wire surface is less flexible for any future legitimate
  per-call multi-vault use case — would need a new, explicit mechanism
  (allowlist or similar) if that need ever materializes, not a param revival.
  The daemon's cross-process lock adds a small filesystem dependency
  (`.obsidian-memory-rag/git-sync.lock`) that must be considered by anything
  else that touches that directory.
- Neutral: none of these changes altered any tool's default behavior for the
  single-daemon, single-vault, no-injected-note case that is the common path
  — all regressions were caught by new tests, not by changing existing ones.

## References

- `PROJECTS/cursor-obsidian-memory-guide.md` (vault) — prior audit
  (2026-07-01) that first flagged 6 of these gaps and deferred them.
- ADR-0013 (Syncthing transport — why foreign-host locks are never stolen),
  ADR-0030/0031 (hooks that deferred the transcript-rescan cost), ADR-0037
  (MCP sidecar's own lock, mirrored in spirit by the daemon's), ADR-0038
  (usage-boost lever this ADR corrects the decay behavior of).
