# ADR-0077: The lockfile is a version marker, and an uncovered workspace is drift

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

`v4.6.0` and `v4.7.0` both shipped with `package-lock.json` recording every workspace at
**4.5.1**, while each `packages/<pkg>/package.json`, both README badges, `agent.toml`,
`pyproject.toml` and the Go daemon said 4.6.0 / 4.7.0. Measured, not recalled:
`git show v4.6.0:package-lock.json` and `git show v4.7.0:package-lock.json` both report
`packages/create-vkm-kit` at 4.5.1.

Three independent reasons nothing caught it:

1. **`set` did not write it.** `scripts/version.mjs set` (the release flow's
   `version:set`) rewrote 13 markers; the lock was not one of them, so it was re-synced
   by hand. Because the whole suite is version-locked to the kit (ADR-0042/0051/0058)
   that is **seven** entries to remember, every release, in a 198 KB generated file.
2. **`check` did not read it.** CI's `lint` job runs `version.mjs check`, which surveyed
   only the marker table — so the gate that exists to make version drift unshippable
   was green while the drift was in the tree.
3. **`npm ci` does not care.** It installs a workspace from that workspace's own
   `package.json` and never compares it with the lock's copy. Measured:
   `npm ci --dry-run` exits 0 against the drifted lock.

The published tarballs were never wrong — npm packs the version from `package.json` — so
this shipped no user-visible bug. What it corrupts is the repo's own claim that one
version is the source of truth: anything that reads the lock as a record of what was
released (a bisect, a supply-chain audit, an `npm ls` diff) reads a version that no
release ever had. And each hand re-sync is an unreviewed edit to a generated file, made
under release-day pressure, which is exactly how it was skipped twice.

## Decision

**1. Every npm workspace's lock entry is a marker.** `WORKSPACES` is derived from the
existing `packages/<dir>/package.json` markers rather than listed a second time, so a
package that has a `package.json` marker has a lockfile marker for free — there is no
second list to forget.

**2. The write is a scoped string replace, not a JSON round-trip.** Anchored on the
entry's own `"<dir>": {`, with `[^{}]` so the match cannot cross into a nested object.
It therefore rewrites that workspace's top-level `"version"` and nothing else — not a
nested dependency's, not `packages/<dir>/node_modules/...` (a different key, excluded by
the closing quote before the colon). Measured on the real lock: **7 changed lines**.

**3. A lock workspace entry that no marker covers is itself drift.** npm regenerates the
lock on install, so a package added without its `package.json` marker appears in the
lock and is reported (`npm workspace with no marker — add its package.json to
FILE_MARKERS`). This closes a hole older than this ADR: the marker table was hand-listed,
so a forgotten package used to drift in silence everywhere, not just in the lock.

## Alternatives considered

- **`npm install --package-lock-only` as a release step.** npm's own tool, no regex to
  maintain. Rejected as the mechanism: it fixes `set` and leaves `check` blind, so CI
  would still pass on a drifted lock — and the drift arrives precisely when someone skips
  a step of the release flow, which is the step it would be. It also needs a
  registry-resolvable tree (`version.mjs` deliberately has zero deps and runs **before**
  `npm ci`, including in CI) and can churn unrelated resolution in the middle of a
  release commit. Nothing stops a maintainer from running it; `check` now grades the
  result either way, which is the property that was missing.
- **JSON round-trip (`JSON.parse` → mutate → `JSON.stringify(x, null, 2) + "\n"`).**
  Verified byte-identical to npm's own output on the current lock, so it was tempting.
  Rejected: if npm's writer ever changes shape, one version bump silently becomes a
  whole-file rewrite inside a release commit — a valid file and an unreviewable diff. The
  scoped replace fails **loudly** instead, on the existing "refusing partial write"
  guard, if `"version"` ever moves behind a nested object.
- **One marker for the whole lockfile** (read the first workspace, write all seven).
  Rejected on the precedent this file already paid for: the Go daemon's two version
  copies were one marker, and because `set` skips a file whose `read` already matches,
  the second copy could drift forever while `check` reported `ok`. Same shape, same trap
  — seven copies behind one reader is that bug with more surface.
- **Leave the lock out and document the manual step.** It was already visible as a manual
  step — 3.10.0's notes record "synced the workspace versions in `package-lock.json`" —
  and it drifted twice anyway. A checklist item that gets skipped is a missing gate, not
  a wording problem.

## Consequences

- Positive: the drift is now visible to the gate that already runs in CI's `lint` job and
  in `release.yml` before publishing. `check` surveys **20** markers, 7 of them the lock.
- Positive: `set` heals the lock as part of the normal release flow, so the hand re-sync
  step disappears.
- Positive: a workspace added without markers is reported instead of drifting silently.
- Negative: the lock is parsed once per lock marker (7 × 198 KB). Measured at **5.1 ms**
  total — noise next to Node's own startup, and the alternative (parse once, thread the
  result through) would break the property that every marker's `read`/`write` is a pure
  string function the tests can exercise on a fixture.
- Neutral: no new dependency; `version.mjs` still runs before `npm ci`.
- Neutral: `set` refuses to write a lock whose shape it cannot match, rather than guessing.

## References

- `scripts/version.mjs` (`LOCKFILE`, `WORKSPACES`, `lockMarker`, `uncoveredLockWorkspaces`)
- `packages/create-vkm-kit/test/version-markers.test.mjs` (3 lockfile cases + the
  read/write inverse sweep over the whole table)
- ADR-0042 / ADR-0051 / ADR-0058 (the version-locked suite that makes this seven entries)
- `CONTRIBUTING.md` § _Releasing_, `ARCHITECTURE.md` § _Version guard_
