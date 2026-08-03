> [🇪🇸 Español](../es/memoria-postgres.md) · 🇬🇧 English

# Postgres memory — the vault projection

An **optional** layer that copies your vault's index into a local Postgres so it can do the
things SQLite does not do cheaply: walk the relation graph **several hops deep** in one
query, run **SQL analytics** over the whole vault, keep a **temporal record** of what
changed and when, and **push real-time events** to the console.

It replaces nothing. The search you use every day (`vault_hybrid_search`) still runs over
`fts.sqlite` exactly as before — see
[ADR-0084](../adr/0084-postgres-projection-layer.md).

---

## First: what a "projection" is

Three properties worth internalizing before switching anything on:

| Property              | What it means in practice                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Derived**           | Built **from `fts.sqlite`**, which is built from your notes. Nothing writes to Postgres except the sync. No note is ever born here.             |
| **Disposable**        | Delete the whole directory and you lose nothing: `vkm-pg-migrate --rebuild` recreates it with one command.                                      |
| **Outside the vault** | It lives in `~/.vkm/pg/<slug>/`, **not** inside the vault. A binary datadir inside a repo the daemon watches would be a permanent commit storm. |

> **The vault governs.** Markdown under git remains the single source of truth
> ([ADR-0037](../adr/0037-vault-vs-database-system-of-record.md)). If the projection and the
> notes disagree, the projection is wrong and gets rebuilt.

The default engine is **PGlite 0.5.4**: Postgres 18 compiled to WASM, running **inside the
Node process** over a plain directory. There is no server to install, no service, no
`initdb`, no externally reachable port. If you already run a real Postgres, point
`VKM_PG_DSN` at it and the same code runs against it.

---

## Turning it on

### At install time

```bash
npx @vkmikc/create-vkm-kit --full            # --postgres is on by default
npx @vkmikc/create-vkm-kit --full --no-postgres    # skip the Postgres layer
npx @vkmikc/create-vkm-kit --full --pg-dsn "postgres://user:pass@localhost:5432/vkm"
```

- `--postgres` (**on** by default) installs the layer and sets `VKM_PG=1` in the vault's MCP
  configuration. After the FTS index is built, the installer starts the pg-service and
  **syncs your vault into the projection**: `full` the first time (empty / never synced),
  `incremental` on reinstall or update when `/api/health` already shows notes or a
  `lastSyncAt` — so every user who re-runs the installer keeps Postgres aligned without
  re-dumping the whole index.
- `--no-postgres` leaves it out. The kit works the same; the three Postgres tools simply are
  not registered.
- `--pg-dsn <string>` uses **your** Postgres server instead of embedded PGlite. No embedded
  datadir is created. The DSN is written to `~/.vkm/pg/<slug>/hook-dsn` (mode `0600`) so the
  SessionStart keep-alive hook can respawn the service without putting credentials into
  `~/.claude/settings.json`.

### By hand, with environment variables

| Variable           | What it does                                                                          | Default                 |
| ------------------ | ------------------------------------------------------------------------------------- | ----------------------- |
| `VKM_PG`           | `1` enables the layer. Without it, everything else is inert.                          | off                     |
| `VKM_PG_DSN`       | Connection string for an external Postgres. When set, the service stops using PGlite. | (empty → PGlite)        |
| `VKM_PG_DATA_ROOT` | Where the per-vault home lives.                                                       | `<home>/.vkm/pg`        |
| `VKM_PG_PORT`      | Pin the service port instead of taking a dynamic one.                                 | `0` (dynamic)           |
| `VKM_PG_MODEL`     | Ollama model for migration enrichment.                                                | `phi4-mini:3.8b-q4_K_M` |

The vault is resolved the same way as everywhere else in the kit: `VKM_VAULT`, else
`BASIC_MEMORY_HOME`, else `OBSIDIAN_MEMORY_VAULT`.

### What lives in the per-vault home

`~/.vkm/pg/<slug>/`, where `<slug>` is the vault's folder name plus 8 hex characters of the
SHA-256 of its absolute path — so two vaults with the same folder name never collide:

| File                  | What it is                                                                       |
| --------------------- | -------------------------------------------------------------------------------- |
| `data/`               | The PGlite datadir (never edit by hand; unused with `VKM_PG_DSN`).               |
| `service.json`        | `{ port, pid, vault, version, startedAt }` for the live service.                 |
| `service.token`       | 32 random bytes in hex; the auth token (mode `0600` on POSIX).                   |
| `service.lock`        | `{ pid, port }`; if that process no longer exists, the lock is stale and can go. |
| `hook-dsn`            | External DSN for the SessionStart hook (mode `0600`; only when `--pg-dsn` set).  |
| `migration-report.md` | The last migration's report: what synced, what was suggested, how long it took.  |

---

## The service: exactly one writer

PGlite allows **one process per datadir**. Two MCP servers opening the same directory
corrupt it, so everything goes through a single HTTP service on `127.0.0.1` with a dynamic
port. The MCP tools and the console are **clients** of that service; they never open the
datadir.

- It binds **loopback only**. There is no flag to expose it to the network.
- Every route requires the `x-vkm-pg-token` header carrying the contents of
  `service.token`. The only exception is `GET /api/health`. A missing or wrong token gets
  `401 {"error":"unauthorized"}`.
- `vault_pg_status` **starts it on demand**, so in normal use you never launch it yourself.

---

## The migration CLI, step by step

`vkm-pg-migrate` is what creates and fills the projection the first time.

**1. First build.** Dump the index and create the schema:

```bash
VKM_PG=1 vkm-pg-migrate --vault "<PATH_TO_VAULT>"
```

Under the hood: `python -m obsidian_memory_rag json-dump-index` reads **only `fts.sqlite`**
and emits one JSON object (a manifest of every indexed path plus the changed rows); the
service applies it inside a transaction, deletes rows whose path left the manifest, and
advances the `cursor_mtime_ns` cursor. Nothing on that path reads a `.md` file directly —
only `--enrich` does, read-only, to build its prompts.

**2. Check it landed.** The report is written to
`~/.vkm/pg/<slug>/migration-report.md`, and live state comes from:

```bash
curl http://127.0.0.1:<port>/api/health
```

**3. Catch it up later.** The sync is incremental by `mtime_ns`, so re-running the migration
only touches what changed. From an agent, `vault_pg_status` syncs and answers in one call.

**4. Rebuild from scratch** (after a Postgres upgrade, or if you suspect corruption):

```bash
vkm-pg-migrate --vault "<PATH_TO_VAULT>" --rebuild --yes
```

On the default backend (PGlite) it deletes the local datadir and rebuilds from the dump.
With `VKM_PG_DSN` there is no local datadir: instead it `TRUNCATE`s the contract tables
(`notes`, `chunks`, `relations`, `observations`, `activity`, `suggestions`) in one
transaction, drops the sync cursor and forces a full resync. Safe by design: the projection
is disposable. Two guard rails in both cases: it **refuses** while a `pg-service` holds the
database (stop it first), and without `--yes` it asks for confirmation.

### Every flag

| Flag             | What it does                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `--vault <path>` | Vault to project. Falls back to `VKM_VAULT` / `BASIC_MEMORY_HOME` / `OBSIDIAN_MEMORY_VAULT`.  |
| `--full`         | Full resync instead of the incremental one (ignores the cursor).                              |
| `--rebuild`      | Rebuild from scratch: delete the datadir (PGlite) or `TRUNCATE` + cursor (with `VKM_PG_DSN`). |
| `--enrich [N]`   | Local-LLM suggestion pass over up to `N` unstructured notes (default 25).                     |
| `--model <name>` | Ollama model for `--enrich`. Beats `VKM_PG_MODEL`.                                            |
| `--dry-run`      | Print what it would do; touch nothing.                                                        |
| `--yes`          | Skip the `--rebuild` confirmation.                                                            |
| `--json`         | Machine-readable summary on stdout.                                                           |
| `--no-report`    | Do not write `migration-report.md`.                                                           |
| `--help`, `-h`   | Print the help and exit (touches nothing).                                                    |

Any other argument aborts with `unknown flag: <flag>` and exit code 1 — no flag is silently
ignored.

### `--enrich`: suggestions, never writes

```bash
vkm-pg-migrate --vault "<PATH>" --enrich
vkm-pg-migrate --vault "<PATH>" --enrich 100 --model "qwen2.5:7b"   # wider pass, other model
```

With `--enrich`, a **local** model (Ollama, `phi4-mini:3.8b-q4_K_M` by default) reads notes
that have **no** relations and **no** observations and proposes the typed structure the
prose implies but nobody wrote down. The cap (default 25 notes) keeps a first run bounded.

> ⚠️ **Doctrine: it proposes, it does not write.** Enrichment writes **exclusively** to the
> `suggestions` table. It never touches `notes`, `relations`, `observations`, or any `.md`
> file. Nothing enters your knowledge graph until you accept it — the same rule as
> `vault_kg_suggest` ([ADR-0023](../adr/0023-structured-knowledge-graph.md)) and
> `vault_memory_report` ([ADR-0024](../adr/0024-memory-reports-and-compaction.md)).

Read the pending suggestions with:

```bash
curl -H "x-vkm-pg-token: $(cat ~/.vkm/pg/<slug>/service.token)" \
     "http://127.0.0.1:<port>/api/suggestions?status=pending"
```

If Ollama is not running, `--enrich` **does not break the migration**: the deterministic
part completes, the report records `enrichment: skipped` with the reason, and the exit code
stays 0 ([ADR-0047](../adr/0047-ollama-structured-outputs.md)). The same happens when a
`pg-service` holds the datadir — the enrichment pass needs exclusive database access, so
stop the service and re-run if you want it.

---

## The three MCP tools

They register only when the layer is on. Their parameters mirror the HTTP API's.

### `vault_pg_status`

Projection health: backend, row counts, last sync. **Starts the service when it is not
running**, so it is usually the session's first call.

```jsonc
{ "name": "vault_pg_status", "arguments": {} }
```

Response (abridged):

```json
{
  "ok": true,
  "backend": "pglite",
  "pgVersion": "18.x",
  "notes": 412,
  "chunks": 3180,
  "relations": 907,
  "observations": 1544,
  "lastSyncAt": "2026-08-02T09:14:03.000Z",
  "capabilities": { "vector": true, "notify": true }
}
```

### `vault_graph_hops`

Multi-hop typed traversal via recursive SQL — the query that on the SQLite index would be N
chained `vault_relations` calls.

```jsonc
{
  "name": "vault_graph_hops",
  "arguments": {
    "from": "PROJECTS/create-vkm-kit.md",
    "depth": 3,
    "direction": "both",
    "types": "implements,supersedes,part_of",
    "scope": "PROJECTS",
    "limit": 200
  }
}
```

Returns `nodes` (`path`, `title`) and `edges` (`source`, `type`, `target`, `depth`).
On the MCP tool `from` is **required**, `depth` ranges 1–4 (default 2), `direction` is
`out`, `in` or `both` (default `both`), `limit` ranges 1–200 (default 50), and optional
`scope` keeps both endpoints of every edge inside a path-prefix namespace (same contract as
`vault_timeline`). The whole graph comes from the HTTP API instead: `GET /api/graph`
without `from` returns it, capped by `limit` (500 edges by default).

### `vault_timeline`

Recent activity from the projection's sync log: which note was upserted or removed, when a
sync ran, when a migration happened.

```jsonc
{ "name": "vault_timeline", "arguments": { "limit": 20 } }
```

Each event carries `id`, `at`, `kind` (`note_upsert`, `note_remove`, `sync`, `migrate`,
`suggestion`), `path` and a free-form `detail`. Without `sinceId` it returns the **newest
first**; with `sinceId` it pages forward in **ascending** order from that id. It also
accepts `scope`.

---

## Per-agent and per-project memory

The vault is **one** and the index is **one** — what exists are **namespaces**
([ADR-0086](../adr/0086-scoped-memory-namespaces.md)): `PROJECTS/<project>.md` for
projects (the existing convention) and a top-level `AGENTS/` folder with one note per
agent (`AGENTS/<agent-name>.md`), carrying the same structures — frontmatter, typed
relations and `[category]` observations. The starter vault ships the template
(`AGENTS/TEMPLATE.md`). No vault-per-agent: that fragments the memory, and cross-project
leakage is handled by scoping the recall, not by multiplying indexes
([ADR-0074](../adr/0074-cross-project-leakage.md)).

Retrieval gains one generic filter named **`scope`**: CLI flag `--scope`, a `scope` param on
the path-filtering MCP tools (`vault_hybrid_search`, `vault_fts_search`,
`vault_observations`, `vault_timeline`), and a `scope` query param on the service's
`/api/graph`, `/api/timeline`, `/api/stats` and `/api/search`. The semantics are a posix-style relative
path prefix matched at **segment boundary**: a path `P` matches a scope `S` iff `P == S`,
`P == S + ".md"` or `P` starts with `S + "/"`. Case-sensitive. A scope containing `..`, a
leading `/`, a drive letter or backslashes is **rejected with an error** (not with "zero
results"). It is applied **after** the existing `section` filter.

```jsonc
// One project's note only
{ "name": "vault_hybrid_search", "arguments": { "query": "sync cursor", "scope": "PROJECTS/vkm-kit" } }

// The gotchas recorded in one agent's memory
{ "name": "vault_observations", "arguments": { "category": "gotcha", "scope": "AGENTS/vkm-implementer" } }

// Recent activity across every agent memory (via the projection)
{ "name": "vault_timeline", "arguments": { "limit": 20, "scope": "AGENTS" } }
```

`assemble_context` additionally takes `agentName`: it includes the `AGENTS/<agentName>.md`
note in the budgeted bundle, exactly as `project` includes the `PROJECTS/` one.

---

## The HTTP API

Base: `http://127.0.0.1:<port from service.json>`. Header
`x-vkm-pg-token: <contents of service.token>` on everything except `/api/health`.

| Method + route         | What it does                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`      | Backend, PG version, counts, last sync, `capabilities`, whether it is watching. **No token.**                        |
| `POST /api/sync`       | `{"mode":"incremental"\|"full"}` → rows synced, the new cursor and `tookMs`.                                         |
| `GET /api/graph`       | `from`, `depth` (1–4), `direction` (`out`/`in`/`both`), `types` (csv), `limit`, `scope` → `nodes` + `edges`.         |
| `GET /api/timeline`    | `limit` (1–1000, default 50), `sinceId`, `scope` → activity events.                                                  |
| `GET /api/stats`       | `scope`. Aggregates: notes by folder, observations by category, relations by type, top tags, chunks.                 |
| `POST /api/search`     | `{"q":…,"limit":N,"mode":"fts"\|"vector","scope":…}`. **Analytics, not ranking**: day-to-day recall stays in SQLite. |
| `GET /api/events`      | SSE stream. `hello` on connect, `activity` per new row, a heartbeat comment every 25 s.                              |
| `GET /api/suggestions` | `status=pending` → what `--enrich` proposed, unapplied.                                                              |

> `mode:"vector"` needs on-disk embeddings and the `vector` extension. When either is
> missing it answers **HTTP 200** with empty `hits` and an `error` field explaining why — it
> does not throw.

On the ordering and `scope` of these routes:

- **`/api/timeline`**: without `sinceId` it returns events **newest first**
  (`ORDER BY id DESC`); with `sinceId` it switches to **ascending** from that id, which is
  what makes forward pagination useful. A scoped timeline drops rows with a NULL `path`
  (`kind:"sync"`, `migrate`): a vault-wide event is not attributable to a namespace.
- **An invalid `scope`** (`..`, leading `/`, drive letter, backslash) →
  `400 {"error":"invalid scope"}` on all four routes. Never "zero results".
- On `POST /api/search` the body's `scope` field wins; `?scope=` on the URL is accepted for
  parity with the GET routes.

---

## Troubleshooting

### "The service is not running"

Symptom: a tool returns a connection error, or `curl` to `/api/health` never answers.

1. Call `vault_pg_status`: it starts the service by itself.
2. If it persists, look at `~/.vkm/pg/<slug>/service.lock`. If the `pid` inside no longer
   exists, the lock is **stale**: delete it and retry.
3. Check that `VKM_PG=1` is actually in the MCP server's environment (not just in your
   shell) — it is the master switch.

### 401 `unauthorized`

The `service.token` value changed (the service restarted) or you copied it with a trailing
newline. Re-read the file verbatim. Remember `/api/health` needs **no** token: if that route
answers and the others 401, the problem is the token, not the service.

### Node 20 and the `pgvector` package

The kit supports **Node ≥ 20** and does not use the `pgvector` npm package (it requires
Node 22). Vectors are written as the text literal `'[f1,f2,…]'::vector`. If you see an error
demanding Node 22, something installed `pgvector` on its own: remove it, it is not needed.

### A Postgres major upgrade invalidates the datadir

PGlite embeds one server version. When the kit moves off PG18, your existing directory
**will not open** — and there is no `pg_upgrade` here, by design. The rule is the disposable
projection:

```bash
vkm-pg-migrate --vault "<PATH_TO_VAULT>" --rebuild
```

`meta.pglite_version` records the version the datadir was created with, precisely so this
case is detected and reported instead of failing strangely.

### With `VKM_PG_DSN`, vector search says "unavailable"

Your Postgres does not have the `vector` extension and the service could not create it. Not
fatal: `capabilities.vector` flips to `false`, the `vec` column is skipped, and **everything
else keeps working** (graph, timeline, stats, FTS). Install `pgvector` on that server if you
want it.

### The git daemon started committing strange files

It should not: the projection lives outside the vault. If you moved it with
`VKM_PG_DATA_ROOT` to a path **inside** the vault, move it back out — that is exactly the
failure the "outside the vault" rule prevents.

---

## More

- The decision and the rejected alternatives: [ADR-0084](../adr/0084-postgres-projection-layer.md).
- What it (partly) reverses: [ADR-0083](../adr/0083-memory-remaster-no-postgres.md).
- The console that consumes `/api/events` live: [console](console.md).
- Repo technical map: [`ARCHITECTURE.md`](../../ARCHITECTURE.md).
