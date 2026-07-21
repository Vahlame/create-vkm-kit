# The consolidated summary template

Copy the shape below when writing/rewriting `RESEARCH/<topic>/summary.md`. The validator
(`scripts/validate_summary.mjs`) enforces the rules at the bottom — keep the frontmatter
keys verbatim.

```markdown
---
status: consolidated
consolidated: <YYYY-MM-DD>
sources: [<the source files folded in — preserve/extend the draft's list>]
---

# <topic> — consolidated

<2-4 sentences: the answer to the question the research set out to settle, stated as
claims you now stand behind. Connect to known work: [[PROJECTS/x]] / [[STACKS/y]].>

## Key claims

- <claim, distilled ACROSS sources — not one bullet per source> ([[link]] where it
  touches the vault)
- <another claim>

## Contradictions & supersessions

- <when a newer source overturned an earlier claim, keep both visible:>
- supersedes [[RESEARCH/<topic>/summary]] <or the note-level target> — <one line: what
  changed and which source settled it>

## Open questions

- <what the sources could NOT settle — mirror these into the hub's "huecos" section>
```

## Rules the validator enforces

1. Frontmatter present with `status: consolidated` — that exact line is what locks the
   note against local overwrites forever.
2. **≥1 `[[wikilink]]`** in the body — an unlinked summary is what the local draft
   already produces; the link is the synthesis.
3. **No draft seams**: no `---` chunk separators, no `## <file>.md` headings, no leaked
   `url:`/`title:` lines. Their presence means the map-reduce draft got promoted, not
   rewritten.
4. Supersessions use the typed form `- supersedes [[target]]` — recoverable by the
   knowledge graph, not just by text.
5. Compression: the body stays **≤60% of the sources' total size** (transcription
   detector); the validator warns below 2% (too thin to trust).
6. Body ≥200 chars — distillation, not disappearance.
