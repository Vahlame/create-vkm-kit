# ADR-0084: A Postgres projection of the vault — additive, derived, disposable

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** maintainer
- **Supersedes:** ADR-0083 Decision 1 ("Postgres/pgvector stays OUT of the memory path").
  ADR-0083 Decision 2 (model-epoch awareness) is untouched and stands.

## Context

ADR-0083 answered "could Postgres be integrated into the memory?" with a reasoned **no**,
one day before this record. The maintainer — who is also the user this kit serves — then
decided the opposite: **integrate it.** That is the fact this ADR exists to write down.
An ADR reversed by the person the software is for is not a mistake being corrected, it is
a preference being exercised, and the honest thing is to say so rather than retrofit a
technical epiphany that did not happen.

What did change technically is the **shape** of the proposal. ADR-0083 rejected
"Postgres **instead of** SQLite". What ships here is "Postgres **beside** SQLite, fed by
it". Each of 0083's three objections was aimed at the first shape; each of them dissolves
against the second, and the point-by-point is worth keeping because the next person to
read 0083 deserves to see exactly which premise moved.

1. **"A server to install, run, secure and migrate on every machine."**
   Dissolved by [PGlite](https://pglite.dev/) 0.5.4: Postgres 18 compiled to WASM,
   running **in the Node process** off a plain directory. There is no `initdb`, no
   service, no port to open, no admin, no `apt install`. The kit's own single-writer
   service binds `127.0.0.1` on a dynamic port and authenticates with a per-vault token
   file — the same localhost-only posture as ADR-0016/0040/0048. A user who _does_ operate
   Postgres points `VKM_PG_DSN` at it and the same code paths run against the real server;
   that is a capability, not a requirement.

2. **"No measurable retrieval gain at vault scale."**
   Still true, and this layer does not claim one. The CI-gated ranking path
   (recall@k / MRR / nDCG / MAP over `fts.sqlite`, ADR-0020/0021) is **untouched** — no
   query the benchmarks measure is rerouted, and the projection does not participate in
   `vault_hybrid_search` at all. What the projection buys is capability SQLite cannot
   express cheaply:
   - **Multi-hop typed traversal** via recursive CTEs — "what reaches ADR-0057 in ≤3 hops,
     through which relation types" is one query instead of N round-trips of
     `vault_relations`.
   - **SQL analytics** over the whole vault — notes by folder, observations by category,
     relation-type histograms, tag frequency — as aggregates, not as an agent re-reading
     notes to count.
   - **A temporal activity log** — an append-only record of what changed and when, which
     a file mtime cannot reconstruct after the fact.
   - **Real-time push** — `LISTEN`/`NOTIFY` (PGlite's `.listen`) turns "did anything
     change?" from polling into an SSE stream, which is what makes the console of
     [ADR-0085](./0085-vkm-console-realtime-binary.md) live rather than refreshed.

3. **"A second source of truth."**
   This is the objection that mattered, and the design answers it structurally rather
   than by promise: **nothing writes to Postgres except the sync**. The projection is
   built from the Python engine's dump of `fts.sqlite`, which is itself built from the
   notes. It is derived exactly the way `fts.sqlite` is derived, it is rebuilt with one
   command, and it lives **outside the vault** so git never sees it. Delete the whole
   directory and the only thing lost is a cache. The vault, in git, remains the single
   source of truth (ADR-0037).

The enrichment path is where a projection could quietly become authoritative, so it is
fenced explicitly: the optional local-LLM pass in `vkm-pg-migrate --enrich` writes **only
into the `suggestions` table**, never into `notes`/`relations`/`observations` and never
into a `.md` file. It proposes; the human accepts. Same doctrine as `vault_kg_suggest`
(ADR-0023) and `vault_memory_report` (ADR-0024).

## Decision

Ship `packages/vkm-memory-pg`: an **optional, additive Postgres projection** of the vault,
off unless asked for, and a strict downstream of the existing index.

**The pipeline.** `python -m obsidian_memory_rag json-dump-index` reads `fts.sqlite` only
and emits one JSON object (manifest of every indexed path + the rows changed since a
cursor); the Node sync applies that into Postgres inside a transaction, deletes rows whose
path left the manifest, and advances a `cursor_mtime_ns` in `meta`. Nothing on the sync path
reads a `.md` file directly, so the projection can never disagree with the index about what
a note contains — at worst it is behind, and `POST /api/sync` catches it up. (The optional
`--enrich` pass does read note files, read-only, to build its prompts; it still writes only
suggestions.)

**Single-writer service.** PGlite allows exactly one process per datadir. A second MCP
server or a second console opening the same directory would corrupt it, so all access goes
through one small HTTP service on `127.0.0.1` (`service.json` records port/pid/vault,
`service.lock` makes a stale pid detectable, `service.token` — 32 random bytes, `0o600` on
POSIX — authenticates every route except `GET /api/health`). Everything else, MCP tools
included, is an HTTP client of that service. This also means the external-DSN backend is a
config change, not a second code path.

**Data outside the vault.** The per-vault home is `~/.vkm/pg/<slug>/`
(`VKM_PG_DATA_ROOT` overrides), where the slug is the vault's basename plus 8 hex of the
SHA-256 of its absolute path — collision-free across two vaults that share a folder name,
and stable across restarts. A PGlite datadir is dozens of binary files rewritten on every
checkpoint; inside a git-synced vault it would churn the daemon's commit loop forever.

**Pinned in lockstep.** `@electric-sql/pglite` 0.5.4 with `@electric-sql/pglite-pgvector`
0.0.5. The extension bundle is compiled against a specific PGlite build; a floating range
on either side is a runtime load failure, not a type error. Both are exact pins, upgraded
together or not at all.

**Vectors as text, deliberately.** Embeddings are written as the literal
`'[f1,f2,…]'::vector`. The `pgvector` npm package would be the idiomatic path and it
requires Node 22; this kit supports Node ≥ 20 and CI has a Node 20 leg. Text literals cost
a few percent on insert and keep the floor where it is.

**The MCP surface stays small.** Three tools:
`vault_pg_status` (health + row counts, starts the service on demand),
`vault_graph_hops` (multi-hop typed traversal), `vault_timeline` (recent activity). The
schema budget of ADR-0035 rises 10,800 → 12,200 chars to pay for them — a raise justified
by capability, recorded here so it is not mistaken for the gate quietly loosening.

## Alternatives considered

- **External Postgres only (require a real server).** Rejected — it violates the property
  every other optional layer in this kit holds: it works out of the box or it is absent.
  Requiring `docker compose up` before memory has a graph makes the graph a feature for
  people who already run databases. The DSN path exists for exactly those people, as an
  option.
- **Swap the Python retrieval backend to `psycopg`/Postgres.** Rejected, and this is the
  one that would have been genuinely harmful: the ranking path is benchmarked and CI-gated
  (ADR-0020/0021), and every number in `evals/retrieval` was produced against FTS5 + the
  cosine scan. Re-implementing ranking in SQL forks the measured path and leaves two
  ranking implementations, one of which nothing gates. The projection reads the index; it
  does not become the index.
- **`pglite-socket` (speak the Postgres wire protocol on a local port).** Deferred, not
  rejected. It would let `psql` and any Postgres client attach to the projection directly,
  which is genuinely attractive for ad-hoc SQL. It also turns a token-authenticated HTTP
  service into a database port, with a different auth story, on a machine where the point
  was "no server to secure". Revisit once the HTTP surface has proven stable.
- **Write the projection into the vault** (e.g. `.vkm-pg/` beside `.obsidian-memory-rag/`).
  Rejected — see above; a binary datadir under a filesystem-watching git daemon is a
  commit storm.
- **Let the enrichment model write relations/observations directly.** Rejected. A local
  model proposing structure is useful; a local model editing the user's knowledge graph
  without review is the exact failure ADR-0023/0024 designed against.
- **Do nothing (leave ADR-0083 standing).** Rejected by the user's decision. Recorded
  plainly rather than dressed up.

## Consequences

- Positive: multi-hop traversal, SQL aggregates over the whole vault, an append-only
  activity log and real-time push exist — all of them impossible or expensive over the
  SQLite index, none of them at the cost of the ranking path.
- Positive: the projection is **disposable by construction**. `vkm-pg-migrate --rebuild`
  deletes the datadir and rebuilds from the dump; the recovery procedure for every class
  of corruption is one command.
- Positive: the same code serves an external Postgres via `VKM_PG_DSN`, so an org that
  already runs one gets the layer inside its own backup/ACL perimeter — the "when it WOULD
  be right" boundary ADR-0083 recorded is now reachable without a rewrite.
- Negative: **WASM footprint.** PGlite plus the pgvector extension is tens of megabytes of
  `.wasm`/`.data` on disk and a real memory floor in the service process. This is the
  single largest optional dependency in the kit, which is why it is opt-out at install
  (`--no-postgres`) and inert unless `VKM_PG=1`.
- Negative: **a Postgres major upgrade invalidates the datadir.** PGlite embeds one
  server version; when it moves from PG18, the existing directory will not open. There is
  no `pg_upgrade` here and there will not be one — the mitigation is the disposable-
  projection rule: detect the version mismatch, say so, and rebuild
  (`vkm-pg-migrate --rebuild`). `meta.pglite_version` is recorded for exactly this check.
- Negative: one more long-lived local process. It binds loopback only, holds a token file,
  and is startable on demand by `vault_pg_status` — but a daemon is a daemon, and the kit
  now has two more (this and the console) than the "no daemon except sync" line of
  ADR-0016.
- Negative: the fixed schema cost every wired agent pays rises — the ADR-0035 gate moves
  from 10,800 to 12,200 chars to fit three more tools. Weighed against that ADR's own rule
  that schemas are input tokens paid every session: accepted for capability, not waived.
- Neutral: vector search through the projection is best-effort. On an external DSN without
  the `vector` extension available, `capabilities.vector` reports `false`, the `vec` column
  is skipped, and everything else still works.
- Neutral: `VKM_PG_PORT` exists for users who want a fixed port; the default is a dynamic
  port recorded in `service.json`, so nothing collides with 8765 / 4319 / 4923 / 4930.

## References

- [ADR-0083](./0083-memory-remaster-no-postgres.md) — the declined proposal this reverses
  (Decision 1 only).
- [ADR-0085](./0085-vkm-console-realtime-binary.md) — the console that consumes
  `/api/events`.
- [ADR-0025](./0025-optional-sqlite-vec-acceleration.md) — the ranking-identical
  acceleration this must not disturb; [ADR-0020](./0020-measured-retrieval-quality.md) /
  [ADR-0021](./0021-ranking-upgrades-and-graded-metrics.md) — the gates that pin it.
- [ADR-0023](./0023-structured-knowledge-graph.md) /
  [ADR-0024](./0024-memory-reports-and-compaction.md) — proposes-never-writes, the doctrine
  `--enrich` follows.
- [ADR-0035](./0035-fixed-cost-diet-schema-budget.md) — the schema budget raised here.
- [ADR-0037](./0037-vault-vs-database-system-of-record.md) — the vault is the memory layer;
  a projection cannot become the system of record.
- [ADR-0047](./0047-ollama-structured-outputs.md) — the local-LLM pattern `--enrich` reuses
  (structured outputs, deterministic fallback).
- [ADR-0078](./0078-allocate-and-hide-a-console.md) — every spawn from the service goes
  through the hidden-console launcher on Windows.
- Guides: [`docs/en/postgres-memory.md`](../en/postgres-memory.md) ·
  [`docs/es/memoria-postgres.md`](../es/memoria-postgres.md).
- PGlite 0.5.4 <https://pglite.dev/> · `@electric-sql/pglite-pgvector` 0.0.5.
