# ADR-0061: Kit update path + skill-structure gate

- **Status:** Accepted (amended 2026-07-22 — orphan sweep scoped to managed roots)
- **Date:** 2026-07-19
- **Deciders:** maintainer

## Context

Once installed, skills and subagent templates live under `~/.claude/skills/` and
`~/.claude/agents/` as real files the user owns and may edit. Until now the only way to pick up a
newer kit release's improvements to those files was re-running the whole installer — and
`installManagedAssets` (`asset-install.mjs`) documents its own policy in so many words: "Install
always overwrites (kit templates are kit-owned, same policy as the hook scripts; users who want to
customize should copy under a different name)." That is the right contract for a first install; it
is the wrong one for an update, because it cannot tell "the kit changed this file" apart from "the
user customized this file" — a re-run would silently clobber an edit with no warning and no way
back.

Separately, the same session that shipped ADR-0060's background deep-research job also produced a
`docs/adr/0053-vkm-design-skill.md` follow-up worth naming honestly here: `vkm-design`'s reference
files had grown past the length where Claude reliably partial-reads them, and none of the four
shipped skills had any mechanical check against Anthropic's own published skill-authoring
checklist (SKILL.md body length, table-of-contents presence, reference nesting depth, path
separators, frontmatter `name` validity). That drift risk was silent — nothing in CI would have
caught a fifth skill shipping a 900-line `SKILL.md` or a Windows-style backslash path in a
markdown link.

## Decision

**Part 1 — self-update (`packages/create-vkm-kit/src/update-plan.mjs`,
`src/version-check.mjs`).**

1. **Three-way hash classification, not two-way.** `classifyAsset` (`update-plan.mjs`) compares
   three hashes per file — TEMPLATE (what this version of the kit ships), RECORDED (the sidecar's
   hash of what was installed last time), and DISK (what's actually there now) — into one of eight
   states: `new`, `unchanged`, `update`, `local-only`, `conflict`, `missing`, `orphan`,
   `untracked`. This is the same model chezmoi calls source/target/destination, and the same
   problem shadcn/ui's `diff` command solves for files copied into a user's own repo. The insight
   that makes it cheap here: the sidecar (`~/.claude/vkm-kit.assets.json`, ADR-0049) already
   recorded the installed hash for uninstall's benefit — that stored hash is the merge ancestor.
   With the ancestor known, "only the kit changed this" (`d === r && t !== r`, safe to apply) and
   "only the user changed this" (`d !== r && t === r`, safe to keep) stop being the same observable
   event as "both changed" (`conflict`, the one state nothing auto-resolves).
2. **The default apply set is deliberately narrow; `--force` covers every "you edited this" state.**
   `APPLY_BY_DEFAULT = new Set(["new", "missing", "update"])` — a plain `--update` writes only the
   states where exactly one side of the three-way comparison moved, or the file simply isn't there
   yet. Neither `conflict` nor `local-only` is in that set: both mean the file on disk carries the
   user's own bytes. `FORCIBLE = new Set(["conflict", "local-only"])` is what `--force` reaches, and
   the pairing is not cosmetic — an end-to-end run caught the earlier version, which forced only
   `conflict`, silently no-opping on `local-only`. That is the COMMON case (any given file changes
   rarely between releases), so a user who explicitly asked to discard their edits was told the run
   succeeded and still had the old file — a no-op that reports success is worse than an error. The
   line worth holding is the DEFAULT (never touch either); an explicit, documented, edit-discarding
   flag that reaches only half of what it claims is a trap, not a safeguard. Both are pinned by
   regression tests. No hunk-level merge is attempted — resolution is file-by-file, not line-by-line
   (see Alternatives).
3. **Orphan removal only when unmodified.** A dest the sidecar still remembers but that no longer
   appears in the current version's file list (the kit dropped it) is removed only when
   `diskHash === recordedHash` — a user-modified orphan is left alone and reported in `skipped`,
   mirroring `removeManagedAssets`'s existing uninstall policy rather than inventing a new one.
   `untracked` (a same-named file the kit never installed) is never written or removed under any
   flag combination.
4. **Opt-in version check, no background phone-home.** `fetchLatestVersion` (`version-check.mjs`)
   is the only network call this package makes on the user's behalf, and it fires from exactly one
   place: the `--check-update` and `--update` code paths in `index.js`. A normal
   `npx @vkmikc/create-vkm-kit` install never calls it. It fails open by design — offline, DNS
   failure, non-2xx, malformed JSON, or a timed-out `AbortController` all collapse to `null`,
   never a thrown error, so a version check can never fail the CLI. `--check-update` is read-only
   (prints installed vs. latest plus a plan summary, writes nothing, always exits 0);
   `--update` applies the plan, and both accept `--dry-run` to preview with zero writes.
5. **Structure gate, allowlist-baseline approach.** `test/skill-structure.test.mjs` reads the same
   `skillAssetFiles()` the installer itself uses (no install side effects — a static check on the
   repo tree) and enforces Anthropic's published skill-authoring checklist: `SKILL.md` body ≤500
   lines past the frontmatter close; any reference `.md` file over 100 lines must carry a
   `## Contents` heading in its first 25 lines; no _new_ relative `.md`-to-`.md` link inside a
   skill (Anthropic's one-level-deep rule — Claude partial-reads nested references); forward
   slashes only in markdown links; every `SKILL.md` frontmatter `name` matches
   `/^[a-z0-9-]{1,64}$/` and excludes "anthropic"/"claude". The one-level-depth rule already had
   four pre-existing cross-references at the time this gate was written (e.g.
   `modes/generate.md -> ../examples/worked-example.md`); rather than force an unrelated refactor
   of working skill content to hit zero, those four are named explicitly in a
   `KNOWN_CROSS_REFS` allowlist — none of them chain further, so the practical depth stays one hop
   even though the letter of the rule is unmet. Any _new_ cross-reference must be added to that set
   deliberately or the file restructured to avoid it; the gate fails on anything not already listed.

## Alternatives considered

- **Full re-run of the installer as the update path.** This is the status quo the whole feature
  fixes: `installManagedAssets` overwrites unconditionally, so it can silently discard a user's
  edit to an installed skill or subagent template with no warning. Fine for a first install (there
  is nothing to lose yet); wrong once files are user-owned.
- **A real three-way text merge / merge tool, chezmoi-style.** Deferred, not rejected outright.
  Line-level conflict resolution needs a merge driver and an interactive resolution UI neither of
  which this CLI currently has, and the hash classification already routes the one genuinely
  ambiguous case — `conflict`, both sides changed — to a human decision (`--force` or leave it)
  instead of guessing. Revisit if `conflict` volume in practice turns out to be common enough that
  file-level all-or-nothing stops being good enough.
- **A git-tracked template directory under `~/.claude/`.** Would give real diff/merge tooling for
  free, but imposes a repository on a directory that today is plain files a user may not want under
  git at all (and that already lives inside their real `~/.claude/` profile, not a sandboxed vault).
  Rejected for the same reason a vault-as-database was rejected in ADR-0037: don't impose
  infrastructure the user didn't ask for.

## Consequences

- **Positive:** an installed skill or subagent template a user never touched now updates itself
  with `npx @vkmikc/create-vkm-kit --update`; one they edited is left alone and named explicitly
  instead of silently overwritten. `--dry-run` makes the whole plan inspectable with zero risk
  before committing to it. The version check is genuinely opt-in and fails open, so it can never
  turn a routine install into a network-dependent operation. The structure gate turns Anthropic's
  published skill checklist from a one-time manual pass into a permanent CI check that a fifth
  skill, or an edit to any of the current four, cannot silently violate.
- **Negative, named honestly:**
  - **v1 covers the hash-guarded ASSET layer only** — the files `skillAssetFiles()` enumerates
    under `~/.claude/skills/` and `~/.claude/agents/`. It does **not** cover the managed rule
    blocks (the `vkm-kit:start/end` markers in `AGENTS.md`/`CLAUDE.md`/the Cursor `.mdc` rule) or
    MCP server registrations in `mcp.json` / `claude mcp` — both still require a normal installer
    re-run (`installRules`, `installMcp`) to pick up changes, and that re-run still uses its own
    existing merge/backup logic, not this three-way plan.
  - **Conflict resolution is all-or-nothing per file**, not a hunk-level merge. A file where the
    kit changed one section and the user edited an unrelated section still classifies as
    `conflict` and needs `--force` (discarding the user's edit) to pick up the kit's change at all
    — there is no way to take both without manual reconciliation.
  - **The registry check needs network and silently degrades.** `fetchLatestVersion`'s fail-open
    behavior is the right default (a version check must never crash the CLI), but it also means an
    offline user gets an honest "skipped" line with no update information, not an error — this is
    a real information gap, not a bug, and worth knowing before relying on `--check-update` in a
    disconnected environment.
- **Neutral:** the sidecar manifest gains an optional top-level `kitVersion` string, written only
  when `applyUpdatePlan` actually changes or removes something; a sidecar written by a pre-ADR-0061
  kit simply lacks the key, which reads back as `null` ("unknown") rather than an error. The
  structure gate's `KNOWN_CROSS_REFS` allowlist is a baseline, not a ratchet — it can shrink as
  skills get restructured, but any growth is a deliberate, reviewable diff.

## Amendment (2026-07-22): orphan sweep scoped to managed roots

Field failure, reproduced on a real machine the day after v4.5.1: `node
packages/create-vkm-kit/src/index.js --update` reported `orphan: 1 … Removed: 1` and deleted
`~/.claude/output-styles/vkm-terse.md` — the ACTIVE output style, installed and managed by the
token-saver module (ADR-0043), still shipped by the kit, and still referenced by
`settings.json`'s `outputStyle`.

Root cause: the sidecar manifest (`~/.claude/vkm-kit.assets.json`, ADR-0049) is SHARED — every
module that installs hash-tracked files records into it (`skills-install.mjs` for
skills/agents, `token-saver.mjs` for the output style). But `buildUpdatePlan`'s orphan sweep
iterated **every** sidecar entry absent from the caller's `files` list, and the `--update`
caller passes only `skillAssetFiles(home, …)` — the documented skills+agents scope. From that
narrow vantage point, any other module's recorded asset is indistinguishable from "the kit
dropped this file": the classification (`templateHash: null, recordedHash` present → `orphan`)
was correct per Decision item 3; the CANDIDATE SET was wrong. The unmodified-only guard made it
worse, not better — a pristine, kit-owned file is exactly the one that hash-matches its record
and gets deleted.

Fix: `buildUpdatePlan` accepts `managedRoots` (absolute directories bounding the orphan sweep);
sidecar entries outside every root are omitted from the plan entirely — they are not orphans,
not `untracked`, not counted, not reported: another module's property, invisible to this plan.
Both `--check-update` and `--update` pass `updateRoots(home)` =
`[~/.claude/skills, ~/.claude/agents]` (`index.js`), which makes the implementation finally
match the help text's claim of what `--update` manages. Omitting `managedRoots` keeps the old
sweep-everything behavior for single-owner sidecars (test fixtures). Regression tests in
`test/update-plan.test.mjs`: a scoped sweep that removes a genuine in-root orphan while
leaving an out-of-root entry untouched (file AND sidecar claim), plus an end-to-end
reproduction that installs the real style via `configureTokenSaver` and asserts it survives
the exact `--update` flow.

Design note for future modules: any new module that records assets into the shared sidecar
must either live outside the update roots (nothing to do — the sweep cannot reach it) or be
added to BOTH `skillAssetFiles`-style enumeration and `updateRoots` at the same time, never
just one.

## References

- `packages/create-vkm-kit/src/update-plan.mjs` (`classifyAsset`, `buildUpdatePlan`,
  `applyUpdatePlan`, `summarizePlan`, `readKitVersion`, `APPLY_BY_DEFAULT`, `UPDATE_STATES`),
  `src/version-check.mjs` (`fetchLatestVersion`, `compareSemver`, `updateBanner`),
  `src/asset-install.mjs` (`installManagedAssets`, the "Install always overwrites" policy this
  ADR adds an update-safe alternative to), `src/index.js` (`--check-update`/`--update`/`--force`
  wiring, `--dry-run` reuse).
- `packages/create-vkm-kit/templates/skills/vkm-design/references/foundations.md` and its seven
  sibling reference files over 100 lines (each carries the `## Contents` heading the gate
  requires), `test/skill-structure.test.mjs` (the gate itself, `KNOWN_CROSS_REFS`).
- Verification pass for this change: `npm test --workspaces --if-present` 895 tests total, 894
  pass, 0 fail, 1 pre-existing skip; `npm run lint` / `npm run typecheck` / `npm run
sync-agents:check` / `npm run license:sync:check` / `node scripts/version.mjs check` / `npm run
linkcheck` all exit 0; `node evals/run-adherence-ci.mjs` reports `adherence_score=1.000 (20/20)`.
  End-to-end update flow verified against a throwaway `HOME` (never the real `~/.claude`): a
  locally edited file classified `local-only`, a deleted file classified `missing`; `dryRun:true`
  produced a byte-for-byte-identical disk state before/after; a real apply restored the deleted
  file, preserved the edited file's content, and stamped the sidecar's `kitVersion` to
  `readKitVersion()`'s value; the real CLI's `--update --dry-run` wrote nothing and reported the
  same plan.
- ADR-0049 (skill/subagent hash tracking this reuses as the merge ancestor), ADR-0053
  (`vkm-design`, the skill whose reference-file length prompted the structure gate), ADR-0051 (the
  version-lock policy this update path deliberately does not touch — this ADR is about
  user-editable template files, not package versions).
- Anthropic, "Skill authoring best practices"
  (<https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>) — source
  for the SKILL.md length limit, table-of-contents convention, and one-level reference-depth rule
  the structure gate enforces.
- Prior art cited honestly: chezmoi's source/target/destination three-state model
  (<https://www.chezmoi.io/>), shadcn/ui's `diff` command for components copied into a
  consuming repo (<https://ui.shadcn.com/docs/cli>), `update-notifier`'s opt-in npm version check
  pattern.

<!-- Honesty note: an earlier draft of this session's analysis claimed vkm-design had NO
     evaluation at all. That was wrong — evals/design-bench/ already existed with a reproducible
     baseline-vs-with-skill protocol and 12+ documented runs in RESULTS.md before this ADR. The
     gate this ADR adds measures skill STRUCTURE (SKILL.md length, TOC presence, reference depth,
     path separators, frontmatter validity) — a different axis from design-bench's OUTPUT QUALITY
     measurement — so it is not a duplicate of the bench and should never be mistaken for one. -->
