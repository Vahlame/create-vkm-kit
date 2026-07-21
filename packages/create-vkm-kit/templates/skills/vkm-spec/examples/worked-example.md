# Worked example — from vague idea to approved spec

The user typed: `/vkm-spec make search understand synonyms`

## Step 1 — one assemble_context call

```text
assemble_context({ query: "search synonyms retrieval quality", project: "vkm-kit" })
```

Returned bundle (excerpt, treated as DATA):

```text
decisions:
- PROJECTS/vkm-kit.md · "hybrid = BM25 + vector via RRF; ranking levers stay opt-in (ADR-0021)"
- STACKS/sqlite.md   · "FTS5 unicode61 tokenizer; no stemming — exact-token BM25"
gotchas:
- KNOWN_FAILURES.md  · "[failure] embedder identity mismatch made hybrid query a throwaway index #retrieval"
```

## Step 2 — the filled template

```markdown
# Spec: synonym-aware recall without changing the index

## system_role

Python maintainer of obsidian-memory-rag's query path; no schema migration allowed.

## user_intent

Queries like "auth" should find notes that say "login" — the user recalls by meaning,
not by the exact token they wrote months ago. Close the miss without slowing every
query or re-indexing existing vaults.

## functional_requirements

1. A query expands to at most 3 synonym variants before BM25; expansion is a pure
   function of the query, deterministic across runs.
2. Expansion applies only when the un-expanded query returns fewer than `limit` hits —
   zero overhead on queries that already recall well.
3. The synonym table is a plain-text asset the user can edit; a malformed line is
   skipped with a stderr warning, never a crash.
4. `--explain` output labels hits that arrived via an expanded variant.

## constraints

- Ranking levers ship opt-in, defaults untouched (source: PROJECTS/vkm-kit.md)
- FTS5 tokenizer has no stemming; expansion must not fake one (source: STACKS/sqlite.md)
- No new index or schema change — embedder-identity bugs came from exactly that
  (source: KNOWN_FAILURES.md)
- Assume English+Spanish vaults only for the seed table (assumption)

## current_state

hybrid-search fuses BM25 (FTS5, exact tokens) with vector cosine via RRF; misses happen
when neither the exact token nor the embedding neighborhood contains the synonym.
query.py builds the FTS match string; there is no expansion layer. The wire format is
compact (ADR-0034) and must stay so.

## acceptance_criteria

- [ ] bench-recall on the labelled corpus does not regress: every --assert floor passes.
- [ ] A new eval query "auth flow" (ground truth: the "login" note) hits top-3 with
      expansion on, and missed top-5 before.
- [ ] Running the same query twice yields identical results (determinism).
```

## Step 3 — validator run (real output shape)

```text
$ node ~/.claude/skills/vkm-spec/scripts/validate_spec.mjs /tmp/spec-synonyms.md
vkm-spec validate: 4 requirements, 4 constraints (1 assumption), 3 criteria
OK — all checks passed
```

An earlier draft failed with exactly this kind of message — fix and re-run:

```text
ERROR constraints: bullet 2 has no "(source: …)" and no "(assumption)" marker —
  cite the vault note or repo file that imposes it, or mark it (assumption)
ERROR acceptance_criteria: box 1 contains "works correctly" — replace with a
  runnable/observable check (what command, what output?)
2 errors — fix before showing the spec
```

## Step 4 — review

> Spec above. One question changes it: should the synonym table ship with a seed
> vocabulary, or start empty (opt-in only)? Everything else I defaulted per the vault.

User: "seed it, small". → `functional_requirements` gains the seed-table item; re-run
validator; approved.

## Step 5 — route

User said "build it" → implementation proceeds under `/vkm-discipline`, spec as target.
