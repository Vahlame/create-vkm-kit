> [🇪🇸 Español](../es/consola.md) · 🇬🇧 English

# The console — the whole kit, in real time

`vkm-console` is a Go binary that serves **one page** on `127.0.0.1:4930` with the live state
of every piece: the sync daemon, memory, token spend, Postgres projection activity, and
background research jobs.

It replaces running four commands in three languages and correlating timestamps by hand.

**It is strictly read-only.** It writes nowhere, takes no lock, and opens no writable handle
— see [ADR-0085](../adr/0085-vkm-console-realtime-binary.md).

---

## Building it

From a clone of the kit:

```bash
npm run build:console
```

Or straight from the Go toolchain (Go 1.25+), which is the path that always works:

```bash
go build -o bin/vkm-console ./cmd/vkm-console          # Linux / macOS
go build -o bin/vkm-console.exe ./cmd/vkm-console      # Windows
```

Nothing else is needed: HTML, CSS and JS live **inside** the binary via `go:embed`, so there
is no asset folder to locate and no CDN to reach. The page works with no network at all.

If you installed it with the installer flag:

```bash
npx @vkmikc/create-vkm-kit --full --console
```

---

## Running it

```bash
vkm-console --vault "<PATH_TO_VAULT>" --open
```

It prints the URL (with token) and, with `--open`, opens the browser. Without `--open` it
only listens:

```text
vkm-console 5.5.2 listening on http://127.0.0.1:4930/?token=<token> (vault: …)
```

On Windows, a Desktop shortcut:

```bash
node scripts/install-console-shortcut.mjs --vault "<PATH_TO_VAULT>"
```

> ⚠️ **The printed URL is the credential.** `?token=` is minted fresh each start. Opening
> bare `http://127.0.0.1:4930/` shows the **gate page** (how to launch with `--open`), not
> the dashboard. `/static/*` CSS/JS need loopback Host only (not the token); the document
> and APIs still require the token. A successful `?token=` visit also sets an HttpOnly cookie.

### The auth gate

1. **Loopback Host.** `Host` (port stripped) must be `127.0.0.1`, `::1` or `localhost`.
2. **Per-run token** via `?token=`, `x-vkm-console-token` header, or `vkm-console-token`
   cookie — on the document and APIs (not on `/static/*` or `/api/health`). Missing →
   `403` (gate HTML on `/`).

`GET /api/health` stays an ungated liveness probe (`{"ok":true,"version":…}`). `/static/*`
needs loopback Host only:

```bash
curl http://127.0.0.1:4930/api/health                       # no token: 200
curl http://127.0.0.1:4930/api/snapshot                     # no token: 403 forbidden
curl -H "x-vkm-console-token: <token>" http://127.0.0.1:4930/api/snapshot
```

Running it with no `--vault` is fine: the console still starts, and the cards that need a
vault render as "off".

---

## Flags and variables

| Flag / variable                   | What it does                                                           | Default                                                     |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `--vault <path>`                  | Vault to observe.                                                      | `VKM_VAULT` → `BASIC_MEMORY_HOME` → `OBSIDIAN_MEMORY_VAULT` |
| `--port <n>` / `VKM_CONSOLE_PORT` | Listen port (always on `127.0.0.1`).                                   | `4930`                                                      |
| `--open`                          | **Explicit**: open the browser at the URL. Without it, never does.     | off                                                         |
| `--refresh <seconds>`             | How often a full snapshot is pushed down the SSE stream (minimum `1`). | `5`                                                         |

The port is **fixed** on purpose (the kit's others: 8765 basic-memory, 4319 OTLP sink, 4923
vkm-spec GUI). A page you are meant to bookmark cannot move port every boot; the pg-service
does use a dynamic port because nobody types that URL by hand.

It listens on **loopback only**. There is no bind-address flag: exposing a complete reader
of your notes to a home network is not an option that should exist.

---

## The panels

| Panel        | What it shows                                                                                | Where it reads from                                                           |
| ------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Daemon**   | Heartbeat age, last successful push, unpushed commits, rebase aborts, consecutive failures.  | `obsidian-memoryd`'s state file.                                              |
| **Memory**   | Note count, notes by folder, most recently touched notes — plus the projection's aggregates. | A read-only walk of the vault's `.md` files, and `/api/stats` + `/api/graph`. |
| **Tokens**   | Usage per day / model / type and cache-hit ratio.                                            | `vkm-doctor`'s NDJSON rollups in `~/.vkm/telemetry/`.                         |
| **Postgres** | Backend, row counts, last sync, and the projection's activity timeline.                      | `/api/health`, `/api/timeline`, `/api/stats`, `/api/graph` on the pg-service. |
| **Research** | Recent obscura searches and downloads.                                                       | The obscura search log and `~/Downloads/vkm-kit/`.                            |

Every collector is **fail-soft**: a missing or broken source returns an error string and its
card renders as "off" instead of taking the page down. The daemon, the projection and
obscura are all optional; on a minimal install you see one live card and the rest dark.

**Freshness.** The page holds one SSE connection to the console's own `/api/events`. That
stream carries a full snapshot every `--refresh` seconds (default 5) **plus** an immediate,
2-second-debounced push whenever a single `fsnotify` watcher over the vault, the telemetry
directory and the pg data root sees a change. If the watcher cannot start, the periodic
refresh still covers everything.

---

## The no-focus-steal guarantee

This is the property that got the most care, because the kit spent three releases removing
windows that put themselves in front
([ADR-0078](../adr/0078-allocate-and-hide-a-console.md)):

- **Starting the console opens no window at all.** No browser, no Windows console.
- **The browser opens only if you pass `--open`**, on that specific invocation. There is no
  auto-open at start, none on reconnect, and none when a panel errors.
- When `--open` does open the browser, that spawn goes through the hidden-console launcher
  (`throughHiddenConsole()` / `windowsHide`) like every other spawn in the kit.
- The console is a **web page**, not a TUI, precisely because of this: a TUI _is_ a console
  window, and on Windows that means either a visible window or a hidden one nobody can see.

Practical result: you can leave it running while you play a full-screen game — which is
exactly the workload ADR-0078 was measured against.

---

## Troubleshooting

### Port 4930 is taken

```bash
VKM_CONSOLE_PORT=4931 vkm-console --vault "<PATH>"
```

### The Postgres panel says "not running"

The projection is optional and starts on demand. Turn it on (`VKM_PG=1`) and call
`vault_pg_status` from your agent, or run `vkm-pg-migrate` once — see
[Postgres memory](postgres-memory.md). The console **does not** start the service itself:
that would be writing, and it does not write.

### I cannot reach the page from another machine

Correct: it listens on `127.0.0.1`. Use an SSH tunnel
(`ssh -L 4930:127.0.0.1:4930 your-machine`) if you genuinely need it elsewhere. Through the
tunnel the `Host` is still loopback, so the gate accepts it — but you also need that run's
`?token=`.

### `403 forbidden` on everything except `/api/health`

The token is missing or left over from an earlier start. Re-read the line the console
printed and use the whole URL (`http://127.0.0.1:4930/?token=…`), or send the
`x-vkm-console-token` header. Check too that you are reaching it as `127.0.0.1` /
`localhost` and not by the machine's network name: a non-loopback `Host` is rejected even
with a correct token.

### I changed the CSS and nothing changed

Assets are embedded with `go:embed`: rebuild the binary (`npm run build:console`). That is
the price of there being no asset folder that can go missing.

---

## More

- The decision, the rejected alternatives and the consequences: [ADR-0085](../adr/0085-vkm-console-realtime-binary.md).
- The no-focus-steal rule: [ADR-0078](../adr/0078-allocate-and-hide-a-console.md).
- The projection that feeds the activity panel: [Postgres memory](postgres-memory.md).
- The other observability surfaces: [observability](observability.md).
