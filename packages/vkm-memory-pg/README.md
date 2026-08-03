# @vkmikc/vkm-memory-pg

Postgres projection layer for the vkm vault. The **vault stays the source of truth** — this
package maintains a derived, rebuildable database next to it: embedded
[PGlite](https://pglite.dev) by default, or an external Postgres server via `VKM_PG_DSN`.
One single-writer localhost service owns the database; everything else (MCP sidecar,
migrate CLI, dashboards) talks to it over HTTP with a per-vault token.

Enable with `VKM_PG=1`. Data lives under `~/.vkm/pg/<vault-slug>/` (override:
`VKM_PG_DATA_ROOT`).

## Service API

Binds `127.0.0.1` only. Auth: header `x-vkm-pg-token` (from `service.token`); only
`GET /api/health` is exempt.

| Route              | Method | What                                                                     |
| ------------------ | ------ | ------------------------------------------------------------------------ |
| `/api/health`      | GET    | version, backend, counts, capabilities, watching (no token)              |
| `/api/sync`        | POST   | `{"mode":"incremental"\|"full"}` -> synced counts + cursor               |
| `/api/graph`       | GET    | `?from=&depth=1..4&direction=out\|in\|both&types=csv&limit=&scope=` hops |
| `/api/timeline`    | GET    | `?limit=&sinceId=&scope=` activity events                                |
| `/api/stats`       | GET    | `?scope=` notes by folder, observations by category, relations, tags     |
| `/api/search`      | POST   | `{"q","limit","mode":"fts"\|"vector","scope"}` (`?scope=` also accepted) |
| `/api/events`      | GET    | SSE: `hello` frame, `activity` frames, `:hb` every 25s                   |
| `/api/suggestions` | GET    | `?status=pending` enrichment proposals                                   |

`scope` is a posix-style path prefix matched at segment boundary; an invalid one (`..`,
leading `/`, drive letter, backslash) is rejected with `400 {"error":"invalid scope"}`.
`/api/timeline` returns **newest first** by default and switches to ascending order
(forward pagination) when `sinceId` is present.

## Environment variables

| Var                                                         | Meaning                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `VKM_PG`                                                    | `"1"` enables the projection layer                                        |
| `VKM_PG_DATA_ROOT`                                          | overrides the per-vault PG home (default `~/.vkm/pg`)                     |
| `VKM_PG_DSN`                                                | external Postgres connection string (PGlite datadir unused)               |
| `VKM_PG_PORT`                                               | force a fixed service port (default: dynamic, recorded in `service.json`) |
| `VKM_PG_MODEL`                                              | Ollama model for migration enrichment (default `phi4-mini:3.8b-q4_K_M`)   |
| `VKM_VAULT` / `BASIC_MEMORY_HOME` / `OBSIDIAN_MEMORY_VAULT` | vault resolution precedence (same as the sidecar)                         |

## Migration

```sh
vkm-pg-migrate --vault <path>            # incremental sync (uses a running service if any)
vkm-pg-migrate --full                    # resync everything
vkm-pg-migrate --enrich 25 --model ...   # propose relations/observations via local Ollama
vkm-pg-migrate --rebuild --yes           # recreate from scratch (service must be stopped)
vkm-pg-migrate --dry-run                 # print what it would do; write nothing
vkm-pg-migrate --json --no-report        # machine summary, skip migration-report.md
vkm-pg-migrate --help                    # full flag list (also -h)
```

`--rebuild` differs by backend: on PGlite (default) it deletes the local `data/` datadir;
with `VKM_PG_DSN` set there is no local datadir, so it TRUNCATEs the contract tables
(`notes`, `chunks`, `relations`, `observations`, `activity`, `suggestions`) in one
transaction, drops the sync cursor and forces a full resync.

Enrichment writes **suggestions**, never notes: proposals are applied to the vault only
after a human confirms them. Migration completes deterministically — a down or outdated
Ollama records `enrichment: skipped` and exits 0.

## PGlite major upgrades

The datadir is a disposable projection. When the installed PGlite `MAJOR.MINOR` no longer
matches the one that created `data/`, the schema guard reports it and the service/CLI tell
you to run `vkm-pg-migrate --rebuild` — nothing is wiped automatically, and nothing in the
vault is ever touched.
