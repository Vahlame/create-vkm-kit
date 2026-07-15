# ADR-0056: `RESEARCH/` — a persistent web-research knowledge bank in the same vault

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** maintainer (user-approved via `/vkm-spec`, two modifications below)

## Context

`obscura_research` (ADR-0054/0055) already does deep local crawl + local-LLM curation for free
(CPU/RAM, zero Claude tokens) — but every curated passage died with the tool's response. The user
wanted investigations to stop being ephemeral: persist the curated passages with provenance,
index them through the existing hybrid RAG, and let each research pass on a topic accumulate
(dedup, per-topic hub, consolidation) into a bank that improves with use — without contaminating
personal memory recall or mixing the agents that write each vault section (research pipeline vs.
memory-close ritual).

Two decisions were the user's own, made explicit before implementation (`/vkm-spec`, 2026-07-14):

- **Same vault, not a second one.** A second MCP costs ~7.6k chars of schema per session
  (against the token-economy doctrine, ADR-0032/0035), loses `[[wikilink]]` cross-references to
  `PROJECTS/`/`STACKS/`, and duplicates the daemon + index. Isolation is solved at retrieval time
  instead (see Decision, section filter).
- **Consolidation must be dual and generic** ("que sirva para todo"): a Claude-quality mode and a
  free local-model mode, both operating on whatever sits in `sources/` — obscura-persisted or
  hand-imported.

## Decision

Add a `RESEARCH/` section to the existing vault, with structure fixed from day one (not left to
grow organically):

```text
RESEARCH/
  _index.md                  — global index: topic table (status, #sources, last run, summary?)
  <topic>/
    _index.md                — hub: query log (date+query), open questions ("huecos"),
                                which sources are already consolidated
    summary.md                — distilled; frontmatter status: draft-local | consolidated
    sources/
      <hash8-url>-<slug>.md   — verbatim extract + full provenance frontmatter, origin: web
```

Lifecycle per note/summary: `raw` (source just persisted) → `draft-local` (local-Ollama draft) →
`consolidated` (Claude, `/vkm-research`).

1. **`obscura_research` gains opt-in persistence** (`packages/obscura-web`, `src/research-persist.mjs`).
   `persist: boolean` (default `false`) + `topic` (slug `^[\w][\w-]*$`) write one note per curated
   result to `RESEARCH/<topic>/sources/<hash8-url>-<slug>.md` — frontmatter `{url, title,
retrieved, query, extraction: ollama|heuristic, relevant, origin: web, status: raw}`, body =
   the curated extract **verbatim** (ADR-0055's invariant carries over unchanged: the 3.8B model
   is a curator, never an author, for sources). Requires `OBSCURA_RESEARCH_DIR` (typed error if
   unset); every resolved path is root-checked against it before any write (same defense-in-depth
   class as ADR-0040's vault root-lock, scoped to this package). Dedup is by URL hash: a URL seen
   before in the topic updates the existing note in place (`retrieved` refreshed, query appended
   to the hub's log) — never a duplicate. `fetchFailed` results are never persisted;
   `relevant:false` results are, with the flag intact, so the agent (not the local model) makes
   the final call. `persist:false` (the default) is byte-identical to the pre-ADR-0056 tool — 0
   new side effects, existing tests untouched.
2. **`obscura_consolidate(topic, force)`** — the free local-model half of dual consolidation. Uses
   the same Ollama client/model/env as ADR-0055 (`ollama-client.mjs`'s `chatJSON`/`summarizeNotes`)
   to draft/refresh `RESEARCH/<topic>/summary.md`, map-reducing sources in ≤12k-char batches
   without splitting a note across batches. Frontmatter `status: draft-local`, `generated`,
   `model`, `sources`. A `consolidated` summary is **never** overwritten, `force` or not (typed
   rejection — only `/vkm-research` may write `consolidated`); a `draft-local` summary requires
   `force` to regenerate. No Ollama → `OllamaUnavailableError`, no silent fallback (curated
   drafts, unlike source excerpting, have no honest heuristic substitute). Empty `sources/` →
   typed error. Reports `{sources_read, truncated, model, wrote}`.
3. **`/vkm-research` skill (`create-vkm-kit`)** — the Claude-quality half. Reads the topic hub +
   unconsolidated sources, writes/updates `summary.md` with real synthesis, `[[wikilinks]]` to
   `PROJECTS/`/`STACKS/`, and a `supersedes` relation when a newer source contradicts an earlier
   claim; marks the hub with which sources are folded in; sets `status: consolidated`. Doubles as
   the import path for hand-authored reports: any external `.md` dropped into `sources/` with
   minimal frontmatter (`origin`, `retrieved`, `status: raw`) enters the identical flow — the
   mechanism is generic over where a source came from, exactly the "sirva para todo" the user
   asked for.
4. **Retrieval-level separation** (`obsidian-memory-rag`, `obsidian-memory-mcp`) — folder
   convention alone isn't isolation; a bad passage from `RESEARCH/` can still poison a
   memory-recall's ranking. `paths.py` adds `RESEARCH_PREFIX = "RESEARCH/"` +
   `validate_section`/`in_section`/`section_sql_filter`; `search_vault`/`hybrid_search` gain
   `section: "research" | "memory" | None` that cuts **at candidate collection** (BM25 + vector),
   filters graph neighbors, and re-applies the invariant on the final fused list
   (`query.py:699-703`) as defense in depth — a rerank/MMR/usage-boost stage can never resurrect a
   wrong-section path. `None` stays byte-identical to pre-ADR-0056 behavior. CLI gets `--section`
   with `choices` on all four search subcommands. The Node MCP mirrors this: `vault_fts_search`/
   `vault_hybrid_search` gain `section` (zod enum); `assemble_context` gains `include_research`
   (default `false` → passes `--section memory` to the backend), so a project's context assembly
   never silently absorbs research noise.
5. **Installer wiring** (`create-vkm-kit`) — `obscuraWebServer`'s generated MCP config gets
   `OBSCURA_RESEARCH_DIR = <vault>/RESEARCH` by default (the installer already resolves the vault
   path), overridable via `--obscura-research-dir`. Vault scaffolding seeds
   `RESEARCH/_index.md` and links it from `START_HERE.md`'s vault map, so the section is never an
   orphan-at-birth note under the write-time hygiene lint. The managed CLAUDE.md/AGENTS.md block
   gets a short, symmetric es/en rule: research recall uses `section:"research"`, memory recall
   stays uncontaminated (`assemble_context` excludes `RESEARCH/**` unless `include_research:true`),
   the memory-close ritual never writes under `RESEARCH/` (only the obscura pipeline and
   consolidation do), and `origin: web` notes are untrusted data.

## Alternatives considered

- **A second vault / second MCP dedicated to research:** rejected — ~7.6k chars of schema per
  session is a real, permanent per-call cost against the token-economy doctrine (ADR-0032/0035);
  it also severs `[[wikilinks]]` from research notes to `PROJECTS/`/`STACKS/` (a research finding
  that relates to an open project loses that link entirely) and requires a second daemon + index
  to keep in sync. The user rejected this framing directly and confirmed D1' (same vault, richer
  structure) instead.
- **Let the local 3.8B model write summaries for `sources/` directly (skip verbatim):** rejected —
  ADR-0055's invariant (the small model curates, never authors) holds for sources unconditionally;
  the one deliberate, marked exception is `summary.md`'s `draft-local` status, which is never
  presented as `consolidated` and can always be discarded/regenerated. Blurring that line for
  sources would mean a hallucination could enter the bank labeled as a verbatim citation.
- **Let `RESEARCH/` grow unfiltered into every recall:** rejected — the 2026-07-11 context-
  contamination incident is direct evidence that weak, unrelated passages poison ranking; hence
  D4 (section filter cutting at candidate collection, not just at display).

## Consequences

- Positive: research survives past the tool call that produced it, accumulates instead of
  repeating (dedup by URL, per-topic hub), and is retrievable through the same hybrid RAG/MCP
  surface the vault already uses — no new daemon, no new index, no new schema surface beyond a
  few opt-in params. Dual consolidation means a topic gets a usable (if rough) `summary.md` for
  free right after a crawl, with a clear, non-destructive upgrade path to a Claude-quality one.
- Negative: persistence requires `OBSCURA_RESEARCH_DIR` to be set (typed error otherwise, not a
  silent no-op) — one more env the installer has to wire correctly. `obscura_consolidate`'s draft
  quality is bounded by a 3.8B local model (map-reduce paraphrase, not real synthesis) — it is
  explicitly a starting point, not a substitute for `/vkm-research`. `RESEARCH/` is an
  ever-growing section of the vault; that growth is exactly why the `section` filter exists rather
  than being deferred — without it, vault size growth would eventually degrade memory-recall
  ranking quality, the same failure mode the 2026-07-11 incident already demonstrated once.
- Neutral: the managed CLAUDE.md/AGENTS.md block's char budget was raised as a reviewed decision
  (ADR-0036 precedent — growth must be reviewed, not silent): es 8,660→9,375 chars (budget
  9,100→9,850), en 8,421→9,093 chars (budget 8,850→9,550), ~5% headroom preserved in both. The MCP
  schema-budget gate (`obsidian-memory-mcp/test/schema-budget.test.mjs`) needed no change: the new
  `section`/`include_research` params fit inside the existing 10,800-char/450-per-string budget,
  landing at 10,748 total.

## References

- `packages/obscura-web/src/research-persist.mjs` (`persistResults`, `consolidateTopic`,
  `ResearchPersistError`, `validateTopic`, `TOPIC_RE`), `src/obscura-mcp.mjs`
  (`obscura_research`'s `persist`/`topic` params, `obscura_consolidate` tool registration),
  `src/ollama-client.mjs` (`chatJSON`, `summarizeNotes`).
- `packages/obsidian-memory-rag/src/obsidian_memory_rag/paths.py` (`RESEARCH_PREFIX`,
  `validate_section`, `in_section`, `section_sql_filter`), `query.py` (`section` param threaded
  through `search_vault`/`hybrid_search`, final invariant at `query.py:699-703`).
- `packages/obsidian-memory-mcp/src/hybrid-mcp.mjs` (`section` on `vault_fts_search`/
  `vault_hybrid_search`, `include_research` on `assemble_context`), `test/schema-budget.test.mjs`
  (10,800/450-char gate).
- `packages/create-vkm-kit/src/mcp-merge.mjs` (`obscuraWebServer`'s `researchDir` →
  `OBSCURA_RESEARCH_DIR`), `src/memory-rules.mjs` (managed-block "Investigación/Research"
  section), `templates/skills/vkm-research/SKILL.md`.
- ADR-0032/ADR-0035 (token-economy doctrine, schema-budget gate this ADR's new params fit inside),
  ADR-0036 (rules-block diet + drift-gate — precedent for a reviewed budget raise), ADR-0040
  (root-lock defense-in-depth this ADR's `OBSCURA_RESEARCH_DIR` root-check follows), ADR-0054/
  ADR-0055 (`obscura_research`'s deep crawl + local curation — this ADR persists their output),
  ADR-0045 (`assemble_context` single-call budgeted assembly — gains `include_research`).
