# ADR-0070: EOL invariance across the write paths, and three doctrine contradictions

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** maintainer

## Context

A capability audit ran 34 agents across every kit surface — the 22 vault tools, the
11 web tools, the 6 download tools, the 4 skills, the memory protocol and the ADR
backlog — proposing missing tools and skills, with each proposal attacked by an
independent reviewer instructed to reject when uncertain.

**Zero new skills and zero new tools survived.** Nearly every proposal turned out to
be already covered by an existing parameter, or to fail the membership test (a
component belongs only if it measurably improves another component), or to rest on a
premise contradicted by the source.

That is the useful result. What the rejections surfaced was better than what the
proposals offered: **defects that already exist, are cheaper to fix, and are real.**
This ADR takes those.

### 1. The write paths disagreed about line endings

`vaultAppendFile` normalizes its incoming chunk to the file's own EOL
(`vault-fs.mjs`). `vaultEditFile` spliced `newText` in raw with `text.replace()`.

Vault notes are commonly CRLF — the shipped doctrine says so explicitly, and tells the
model to _"anchor each `vault_edit_file` on ONE single line"_ precisely because of it.
A model composes `newText` with LF. So the same content produced a clean note through
one tool and a **mixed-ending** note through the other — and mixed endings then break
the single-line anchoring that rule exists to protect, on top of noising every
subsequent git diff.

### 2. The close ritual named the expensive path only

`memory-rules.mjs` said _"Close = `vault_edit_file`/`vault_write_file` →
`SESSION_LOG.md` (1 line at the end)"_ and never mentioned `vault_append_file` —
whose own tool description calls it _"the CRLF-aware append — the SESSION_LOG
one-liner path, no anchor round-trip"_. The doctrine was routing the most frequent
write in the entire protocol through the path that needs a unique anchor.

### 3. The discipline skill contradicted itself 54 lines apart

`vkm-discipline/SKILL.md` step 5 mandates running the bundled evidence-gate runner
before declaring done. Its "Grounding & guardrails" section then said _"evidence gates
— available as modules you wire when you want them, **off by default**"_. Both
sentences shipped in the same file.

## Decision

**EOL invariance.** A shared `toFileEol(s, eol)` helper, used by both the edit and the
append path. `vaultEditFile` decides the file's EOL once from what is already on disk
and normalizes every `newText` through it. Single-line `newText` is byte-identical to
before — no newlines, no change.

One helper rather than a second copy of the normalization, because the bug _was_ the
drift: fixing it in one place and leaving the other is how it happened.

**Doctrine.** The close ritual now names `vault_append_file` for the `SESSION_LOG`
one-liner (explicitly "no anchor") and keeps `vault_edit_file`/`vault_write_file` for
the incremental `PROJECTS` write, which genuinely needs positioning. The `memory`
level grows 4,593 → 4,626 (es), well inside its 4,800 budget.

**Skill.** The guardrails section states the three guardrails that actually ship —
the stakes ladder from the core arbitration rule, the bundled evidence gate, and the
untrusted-data envelope plus `domains/security.md` — and confines "opt-in" to
everything beyond them.

**No capability claim is attached to items 2 and 3.** They are consistency fixes: no
bench scores "did the model pick the cheaper write path" or "did it ask at high
stakes", so claiming a number would be inventing one.

### 4. The audit measured a different vault than search does

`indexer._should_skip_dir` skips **any** dot-directory; `audit._iter_md_files`
excluded only three by name. `vault_delete_file` soft-deletes into `.trash/` **inside
the vault**, so trashed notes counted toward the audit's token budget, appeared in
`oversized`, and had their `[[wikilinks]]` scanned — reporting on notes retrieval can
never return.

It also produced **false `index_drift`** in the feature added one commit earlier
(ADR-0069): a soft-deleted note showed as `missing` forever, because the index is
correct to omit it. Reproduced live before fixing — a real vault with one trashed note
reported `drift_total: 1`.

An honest note on how this was found: the working hypothesis was the opposite and
stronger — that soft-deleted notes stay **searchable**. An empirical probe (index a
vault with a note in `.trash/`, then search for its distinctive content) refuted it:
`_should_skip_dir` already excludes it. The real bug was the _audit_ side, and only the
probe distinguished them.

Fixed at the root — the audit now applies the same dot-directory rule as the indexer —
rather than by special-casing `.trash` in `index_drift`.

### 5. Two sources of truth for the default search limit

`DEFAULT_SEARCH_LIMIT` is derived once from `VKM_DEFAULT_LIMIT` (ADR-0034's A/B lever),
used in both search tools' schema defaults — and then contradicted by a hardcoded
`String(limit ?? 10)` in both handlers. Harmless today because the schema default
always populates `limit`; a lie that would silently ignore the lever the moment that
default moved. Both now read the constant.

## Alternatives considered

- **Also normalize `oldText` before matching**, which would make multi-line anchors
  work and retire the "anchor on ONE line" rule. Rejected as a separate decision with
  real risk: it loosens match semantics on a path that rewrites the user's notes, and
  a wrong match corrupts data. `newText` normalization has no such downside — writing
  mixed endings is never the correct outcome.
- **Add an `underHeading` parameter to `vault_append_file`** (the audit's most
  developed proposal). Rejected by its reviewer on evidence: the default search payload
  already returns each hit's `heading`, so the anchor is available without a read; the
  claimed token saving would need a write-path bench that does not exist; and the
  kit's own corpora use three different decision-heading names, so the parameter would
  miss and trigger the extra round-trip it was meant to save.
- **Leave the guardrails paragraph alone** as aspirational. Rejected: a skill that
  contradicts itself 54 lines apart teaches the model that its own text is unreliable.

## Consequences

- Positive: a real data-quality defect is gone, pinned by tests that were **verified
  to fail without the fix** (2 of 64) rather than assumed to.
- Positive: the two write paths can no longer drift, because there is one helper.
- Positive: the most frequent write in the protocol is routed to the tool built for it.
- Neutral: +33 chars (es) on the `memory` rules level; no schema characters, no new
  tool, no new parameter.
- Neutral: the audit's headline — zero new tools or skills justified — is itself a
  finding worth recording. The kit's surface is not short of capability.

## References

- `packages/obsidian-memory-mcp/src/vault-fs.mjs` (`toFileEol`, both callers)
- `packages/obsidian-memory-mcp/test/vault-fs.test.mjs` (4 EOL-invariance cases)
- `packages/create-vkm-kit/src/memory-rules.mjs` (close ritual, es + en)
- `packages/create-vkm-kit/templates/skills/vkm-discipline/SKILL.md` (guardrails)
- ADR-0067 (the arbitration rule the guardrails section now cites), ADR-0063 (the
  budget that made "a new tool" the wrong shape for every proposal)
