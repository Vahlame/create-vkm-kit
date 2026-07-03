# ADR-0033: Guard `vault_edit_file` against self-paste frontmatter duplication

- **Status:** Accepted
- **Date:** 2026-07-03
- **Deciders:** maintainer

## Context

A vault-hygiene pass (2026-07-02) found `PROJECTS/cursor-obsidian-memory-guide.md`
**triplicated by a past corrupt edit**: three near-complete copies of the note
concatenated inside itself, the seam falling mid-sentence (the note's own YAML
frontmatter block, including its `permalink`, appeared pasted into the body
twice). The note had grown to 52,920 tokens without anyone noticing — 17 of 18
common sections were byte-identical across the three copies, and the divergent
section (a Post-mortem write-up) turned out to be one continuous passage split
into three complementary fragments by where the paste boundaries fell.

The corruption almost certainly happened through `vault_edit_file`: an edit
whose `newText` accidentally carried the note's full prior content (e.g. an
agent re-reading the file, then writing back a "merged" version through
`newText` instead of a targeted diff) silently produces a well-formed,
one-occurrence match — `vaultEditFile`'s existing uniqueness check
(`oldText` must match exactly once) has no way to catch this, because the
_input_ was unique; the _output_ is what duplicates the note. Nothing in the
write path detects that shape of damage, and the resulting file is valid
Markdown, so no linter or the retrieval-quality benchmark flags it either — it
only surfaced because a human-triggered `vault_memory_report` flagged the note
as oversized and a manual read caught the repetition.

## Decision

Add a targeted, deterministic check to `vaultEditFile`
(`packages/obsidian-memory-mcp/src/vault-fs.mjs`): after applying all edits in
a call, compare how many times the note's **own frontmatter block** (the
`---\n...\n---\n` prefix present in the file before the edit) occurs in the
edited text versus the original. If applying the edit would **increase** that
count, the whole call is rejected before the atomic write — the file is left
untouched, matching the existing all-or-nothing behavior of multi-edit calls.

This is the smallest check that catches the exact failure mode observed: a
`newText` that re-pastes the note's header into its own body. It does not
touch `vault_write_file` (a full overwrite legitimately replaces the whole
file, including its frontmatter, so the same signal would false-positive
there) and it does not generalize to a size/diff heuristic (ponytail
discipline, ADR-0032: the smallest check that fails if the logic breaks, not
a speculative framework for damage patterns that haven't been observed).
Editing the frontmatter itself (e.g. bumping `updated:`) stays allowed — the
guard only fires when the block's _occurrence count_ goes up, not when its
content changes.

Three new tests in `vault-fs.test.mjs`: the guard rejects a self-paste edit
and leaves the file byte-for-byte unchanged; editing the frontmatter in place
is still allowed; an ordinary edit on a note with no frontmatter is
unaffected.

## Alternatives considered

- **Cap `newText` size relative to the file** (e.g. reject an edit whose
  `newText` exceeds N% of the file): rejected. Legitimate large edits exist
  (pasting a long code block, a big table); the size heuristic would false-
  positive on real work while not actually detecting _this_ failure mode (a
  small file could still be self-pasted).
- **Detect general content duplication** (any repeated large substring, not
  just the frontmatter): rejected as premature generalization. The observed
  failure has one detectable, reliable signature — the frontmatter block,
  which every note has exactly once by convention (ADR-0009) — and reusing it
  is the ponytail-style minimal fix. A broader duplication detector can be
  added later if a different corruption shape is ever observed.
- **Fix it only by adding to `vault_memory_report`'s hygiene checks**
  (flag notes whose frontmatter block appears more than once): valuable as a
  _detection_ net for corruption that already happened, but doesn't prevent a
  new occurrence. Both are worth having; this ADR ships the prevention half.
  Adding the detection half to `report.py`/`audit.py` is left as a follow-up,
  not required to close this ADR.

## Consequences

- Positive: the exact corruption pattern that produced a 52.9K-token
  triplicated note can no longer land silently through the primary edit tool;
  the rejection is immediate and the file is left untouched, so the caller
  gets a clear signal instead of a note that only a manual audit would catch
  months later.
- Negative: one more branch in `vaultEditFile`'s hot path — negligible cost
  (one regex match + a substring count on text already in memory).
- Neutral: `vault_write_file` remains unguarded by design (see alternatives);
  a future ADR could add the `vault_memory_report` detection net if a
  different vault suffers this again undetected.

## References

- ADR-0009 (frontmatter convention every note follows).
- ADR-0018 D6 (untrusted-data envelope on reads — this ADR is the writes-side
  counterpart: the vault is trusted data on the way in, but a tool bug can
  still corrupt it on the way out).
- ADR-0024 (`vault_memory_report`, the hygiene surface that caught the
  already-corrupted note in this incident).
- ADR-0032 (token/code discipline — the minimal-check rule this guard
  follows).
- Incident: vault `SESSION_LOG.md` 2026-07-02 (cont. 7) — the cleanup that
  discovered and fixed the triplicated note this ADR prevents recurring.
