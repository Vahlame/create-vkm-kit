# ADR-0085: One real-time console for the whole kit — a Go binary, strictly read-only

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** maintainer

## Context

The kit's health is spread across five surfaces that never meet: `obsidian-memoryd doctor`
prints a daemon state file and exits; `vkm-doctor` reports token/cache usage from the local
OTLP rollups (ADR-0044); `vault_audit` / `vault_memory_report` answer vault hygiene but only
when an agent asks; the Postgres projection ([ADR-0084](./0084-postgres-projection-layer.md))
now keeps an activity log nobody watches; and a background research job (ADR-0060) writes
progress into a log the user has to go find.

Each is a snapshot obtained by typing a command. The question they are all being asked —
"is the thing working right now?" — is a **continuous** one, and answering it currently
means running four commands in three languages and correlating timestamps by hand.

Two constraints frame the answer:

1. **This kit's cardinal Windows sin is stealing the foreground.** ADR-0078 spent three
   releases and a measurement rig removing every console flash from the hook and spawn
   paths. A monitoring UI that opens a browser window when it starts would reintroduce the
   exact defect, and reintroduce it in the piece whose whole job is to be running while the
   user does something else.
2. **A monitor must not be able to break what it monitors.** The interesting state is a
   PGlite datadir with a single-writer constraint, a SQLite index the Python engine owns,
   a git working tree the daemon syncs, and the user's notes. Any of those is corruptible
   by a careless writer.

## Decision

Ship `cmd/vkm-console`: a **single Go binary** that serves one page on `127.0.0.1:4930`,
aggregating every surface into live panels, and that **writes nothing anywhere**.

**Why Go, when three of the four existing surfaces are Node.** Four reasons, in the order
they decided it:

- **Single executable.** The console is the thing you want running while everything else is
  broken. A Node entry point drags in a `node_modules` tree, a version floor and an install
  step; `vkm-console.exe` is a file that runs. The repo already cross-compiles a Go binary
  in the release workflow (`vkm-runhidden`), so this costs no new toolchain.
- **`go:embed`.** HTML, CSS and JS ship inside the binary. No asset directory to locate at
  runtime, no CDN — which also means the page keeps working with no network at all, which
  is the state the kit is designed for.
- **`fsnotify` is already in the module.** The daemon uses it (ADR-0012). Tailing the
  telemetry rollups, the research logs and the daemon state file needs exactly that
  dependency and it is already vendored, tested and cross-platform here.
- **Zero runtime dependencies.** Everything the page needs — an HTTP server, SSE, JSON —
  is stdlib. The console cannot be the thing whose dependency broke.

**Read-only over every source, enforced by how it reaches them.** The daemon state file, the
telemetry NDJSON rollups, the obscura search log and the downloads directory are read, never
written. Vault statistics come from walking the vault's `.md` files read-only — the console
does **not** open `fts.sqlite`, whose single-writer rule belongs to the Python engine. The
Postgres projection is reached exclusively through the pg-service's HTTP API
(`/api/health`, `/api/stats`, `/api/graph`, `/api/timeline`), which is the same single-writer
discipline ADR-0084 established; the console never touches the datadir. It issues no
`POST /api/sync`, no write of any kind, holds no lock, and spawns no subprocess at all
except the browser under `--open`. Worst case for a bug in it is a wrong number on a page.

**Localhost only, and it says so.** It binds `127.0.0.1:4930` — the next free slot in the
suite's allocation (8765 basic-memory, 4319 OTLP sink, 4923 vkm-spec GUI), fixed rather than
dynamic so the URL is memorable, overridable with `VKM_CONSOLE_PORT`. It listens on the
loopback interface, not `0.0.0.0`; there is no bind-address flag, because the failure mode
of one is a home network with an unauthenticated view of someone's notes.

**It never opens a window.** Starting the console prints the URL and nothing else. The
browser opens only when the **user** passes `--open`, and that spawn goes through
`throughHiddenConsole()` / `windowsHide` like every other spawn in the kit (ADR-0078). No
auto-open on start, no auto-open on `--watch`, no "helpfully" re-opening a tab when a panel
errors. The whole point of a background monitor is that it stays in the background.

**Panels.** Daemon (heartbeat age, last push, unpushed commits, rebase aborts) · Memory
(note counts, folder breakdown, most recently touched notes, plus the projection's category
and relation aggregates and a graph slice) · Tokens (per-day/model/type usage and cache-hit
ratio from the `vkm-doctor` rollups) · Postgres (backend, row counts, last sync and the
activity timeline) · Research (recent obscura searches and downloads). Every collector is
**fail-soft by contract**: it returns `ok: false` with a human-readable error and the card
renders as "off". The daemon, the projection and obscura are all optional, and a console
that red-screens because an optional component is absent is worse than no console.

**Freshness without polling the disk.** The page holds one SSE connection to the console's
own `/api/events`. That stream carries a periodic snapshot (`--refresh`, default 5 s) plus
an immediate, 2-second-debounced push whenever one shared `fsnotify` watcher — over the
vault, the telemetry directory and the pg data root — sees a change. A watcher that fails to
start is not fatal: the periodic refresh still covers everything.

## Alternatives considered

- **A Node/Express dashboard reusing `vkm-doctor`'s code.** Rejected — it puts the monitor
  behind the same `node_modules` and Node-version floor as the things it monitors, and
  ADR-0044's sink already showed that a long-lived Node process on Windows is exactly the
  spawn shape ADR-0078 had to fight.
- **A TUI (Bubble Tea or similar) instead of a web page.** Tempting, and it needs no port
  at all — but a TUI **is** a console window, which on Windows means either a visible
  window or a hidden one nobody can see. The kit's whole console posture is "no window
  appears"; a UI that must own a terminal contradicts it. The web page is viewable from a
  second machine on the same desk via an SSH tunnel, which a TUI is not.
- **Extend `vkm-spec`'s existing GUI server (already SSE, already on 4923).** Rejected —
  vkm-spec's server exists while you build a spec and exits; the console's value is being
  up for hours. Coupling a monitor's lifetime to an authoring tool's is how the monitor
  ends up off exactly when something breaks.
- **Poll every source from the page on a fixed clock.** Rejected as the only mechanism: a
  5-second timer makes a note you just wrote take up to 5 seconds to appear, and a 500 ms
  timer walks the vault 120 times a minute for nothing. One `fsnotify` watcher plus a
  debounce gives immediacy where something actually changed and costs nothing when nothing
  does; the timer stays as the floor that covers sources the watcher cannot see.
- **Hold a `LISTEN` on the projection instead of polling its HTTP API.** Rejected — it
  would mean a second long-lived connection into a service whose entire design constraint
  is one writer and one owner, to save four cheap loopback GETs on a refresh tick. The
  console consuming only the documented HTTP surface is what makes "it cannot break the
  thing it monitors" structural rather than careful.
- **Auto-open the browser on start (what every dev server does).** Rejected outright — see
  ADR-0078. `--open` is opt-in, per invocation, and it is the user's keystroke.
- **Bind `0.0.0.0` with a token so it works from a phone.** Rejected — a second auth
  surface guarding a full read of the user's memory, on a home LAN, to save an SSH tunnel.

## Consequences

- Positive: one page answers "is the kit healthy?" continuously, for every component,
  including the ones that previously had no live surface at all (the projection's activity
  log, background research progress).
- Positive: a monitoring bug cannot corrupt memory. The console holds no lock, opens no
  writable handle, and reaches the two locked stores (PGlite, `fts.sqlite`) only through
  their owners.
- Positive: no window ever appears unless the user asks, so it is safe to leave running
  during a full-screen game — the workload ADR-0078 was measured against.
- Negative: another binary to cross-compile, sign-less-ship and keep in the release
  workflow, and another port in the suite's allocation to defend.
- Negative: the UI lives inside a Go binary via `go:embed`, so a CSS change requires a
  rebuild. Accepted: the alternative is an asset directory that can go missing.
- Negative: `4930` is one more fixed port that can collide on a busy machine.
  `VKM_CONSOLE_PORT` is the escape hatch; unlike the pg-service, a dynamic port would make
  the URL unguessable, which defeats a page you are meant to bookmark.
- Neutral: the console is opt-in at install (`--console`) and does nothing when the
  components it reads are absent — on a minimal install it shows one green panel and four
  "not running".

## References

- [ADR-0078](./0078-allocate-and-hide-a-console.md) — the focus-steal rule this obeys
  (`--open` only, spawns through the hidden-console launcher).
- [ADR-0084](./0084-postgres-projection-layer.md) — the projection whose HTTP API feeds the
  Postgres panel; the single-writer rule the console must not break.
- [ADR-0044](./0044-doctor-telemetry-local-otlp-sink.md) — the local OTLP rollups the token
  panel reads; [ADR-0048](./0048-spec-gui-sse-and-ports.md) — suite port allocation.
- [ADR-0012](./0012-go-daemon-cross-platform.md) — the Go module and the `fsnotify`
  dependency this reuses; [ADR-0060](./0060-obscura-deep-research-background-job.md) — the
  background jobs the research panel follows.
- Guides: [`docs/en/console.md`](../en/console.md) · [`docs/es/consola.md`](../es/consola.md).
