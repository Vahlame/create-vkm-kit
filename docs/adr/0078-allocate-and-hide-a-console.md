# ADR-0078: Allocate a console and hide it, rather than deny the child one

- **Status:** Accepted
- **Date:** 2026-07-27
- **Deciders:** maintainer

## Context

Measured live during a deep-research run on Windows 11, with Task Manager's command-line column
on: the processes putting windows on screen were `conhost.exe` children of `ollama.exe`, one per
model load. Each is a real window that appears, **takes the foreground**, and vanishes
milliseconds later. To someone playing a full-screen game while the agent researches in the
background, that is the screen being taken away from them, repeatedly.

The same mechanism has a second, larger source. Every vkm hook is a Node script, the agent host
starts one process per matching event, and two of them fire on **every** `Bash` call and **every**
MCP call (`compact-tool-output`, `compact-mcp-output`) — hundreds per research run. `node.exe` is
a CONSOLE-subsystem binary: when Windows starts one and the spawn did not pass `CREATE_NO_WINDOW`,
the loader allocates a console for it.

Three constraints shape what can be done about it:

1. **The kit does not do the spawning.** The agent host reads `~/.claude/settings.json` and starts
   the hook itself. There is no flag the kit can pass; the only thing it controls is _what_ gets
   spawned.
2. **The obvious protection is what causes the problem.** `CREATE_NO_WINDOW` (Node's
   `windowsHide: true`) leaves the child with **no console at all**. When that child then spawns a
   console-subsystem grandchild — ollama's model runner, Python's workers, `ensure-otel-sink`
   starting a second node — the grandchild does not inherit a console, because there is none to
   inherit, so Windows allocates it a **brand new, visible** one. The flag meant to hide a window
   is what forces one to appear a level down. This is not hypothetical: it is what the `conhost`
   measurement above was showing.
3. **The flag cannot be pushed down.** We do not control how ollama or Python start their own
   children.

An earlier attempt shipped a second binary (`vkm-hookw`) that applied `CREATE_NO_WINDOW` to the
child — the strategy this ADR rejects — alongside the one that does not. Two binaries with
contradictory strategies is how a fix rots.

## Decision

Ship one small Go binary, `vkm-runhidden.exe`, and route hook entries and helper spawns through
it. It works from the opposite end: instead of denying the child a console, it **creates one and
hides it**, then starts the target _without_ `CREATE_NO_WINDOW` so the entire process tree
inherits that single hidden console. A hidden console is still a real console, so nothing
downstream ever needs to allocate a visible one.

Three properties make it correct rather than merely clever:

- **GUI-subsystem** (`-ldflags "-H windowsgui"`), so the loader never allocates a console _for it_.
  Without that flag the launcher flashes exactly like the `node.exe` it replaces.
- **It hides only the console it allocated.** If `GetConsoleWindow()` is non-zero on entry the
  process inherited someone else's — the user's own PowerShell window whenever the binary is run
  from a terminal — and it is left untouched. `ShowWindow(SW_HIDE)` has no undo here: the program
  never shows a window again and exits leaving that terminal alive with no window, recoverable
  only through Task Manager. An inherited console is left visible and the caller accepts the flash.
- **It is transparent.** stdin, stdout and the **exit code** are proxied verbatim. A non-zero
  `PreToolUse` hook is how the memory-write and effort guards block a tool call, so a launcher that
  swallowed the exit code would silently disarm every guard on the machine — strictly worse than a
  flashing window, and invisible.

**Distribution.** The binary is cross-compiled (`GOOS=windows`, `CGO_ENABLED=0`) by the release
workflow, shipped inside the npm tarball (`files: ["bin"]`), and copied to `~/.claude/bin/` by the
installer _before_ any hook entry is written — because `hookInterpreter()` bakes an absolute path
into `settings.json`, and a hook whose `command` does not exist is a hook that never runs. A
`prepack` gate refuses to build a tarball without it. Where the launcher is genuinely absent (a
source checkout with no Go), everything falls back to plain `node`: identical behaviour, visible
flashing.

## Alternatives considered

- **`CREATE_NO_WINDOW` on the child (`windowsHide: true`).** Rejected — it is the cause, not the
  cure. It removes the console of the process we control and thereby forces a _new, visible_ one
  for the console-subsystem grandchildren we do not control. It is also the strategy the retired
  `vkm-hookw` binary implemented, which is how the bug survived a first fix.
- **`ShowWindow(SW_HIDE)` on whatever console is present.** Rejected — this is what the first
  version of `hideOwnConsole` did, and it hides the user's own terminal when the launcher is run
  from one, permanently.
- **A `.vbs`/`.cmd` wrapper (`WScript.Shell.Run ..., 0`).** Rejected — `cscript`/`cmd` are
  themselves console-subsystem, so the wrapper flashes before it can hide anything, and neither
  proxies an exit code without extra machinery.
- **`start /min` or a scheduled-task shim.** Rejected — minimised is still a window that takes
  focus, and both detach the child, which destroys the exit code the guards depend on.
- **Doing nothing and documenting it.** Rejected on measurement: hundreds of foreground steals per
  research run is not a cosmetic complaint.
- **Downloading the binary from a GitHub release with a pinned SHA-256** (the pattern
  `obscura-setup.mjs` uses). Rejected for this artifact — it adds a network dependency to every
  install, and it is circular: the checksum must be baked into the package _before_ the release
  that contains the asset exists, so the first publish of any version ships without a launcher.
- **Leaving the build manual and opt-in.** Rejected as dishonest packaging — it requires Go on the
  user's machine, so in practice the default `npx create-vkm-kit` install would keep flashing while
  the repo claimed the bug was fixed.

## Consequences

- Positive: no console window appears for hooks or for helper spawns on Windows, including for
  processes the kit does not control (ollama, Python), because the whole tree inherits one hidden
  console.
- Positive: the exit-code contract that `PreToolUse` guards depend on is preserved and tested
  end to end (a hook exiting 2 through the real binary still returns 2).
- Positive: one binary, one strategy. `vkm-hookw` and its `CREATE_NO_WINDOW` path are gone.
- Negative: ~2 MB of Windows binary in an npm tarball that every platform downloads (1.1 MB packed).
- Negative: publishing now requires Go in the release job, and a release that skips the build is
  caught by `prepack` rather than by review.
- Negative: running the launcher from a terminal deliberately does **not** hide that terminal, so
  a manual `vkm-runhidden.exe node hook.mjs` still shows the console it inherited. That is the
  safe direction of the trade.
- Neutral: off Windows everything is a no-op — there is no console to allocate in the first place.

## Amendment (5.0.0) — the strategy is now applied everywhere, not just to hooks

"One binary, one strategy" was true of the hook launcher and false of everything else. An
audit for the 5.0 refactor found the rejected approach still live on four paths, including
the two the user actually feels:

| Path                                          | Was                 | Why it mattered                                                                                     |
| --------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `obscura-cli.mjs` — one process per page      | `windowsHide: true` | THE highest-frequency spawn of a research run; obscura drives a browser and spawns its own children |
| `rag-client.mjs` — every vault search         | nothing at all      | `python.exe` is console-subsystem; whether it flashed depended on how the host started the sidecar  |
| `vkm-spec/ollama-client.mjs` — `ollama serve` | `windowsHide: true` | ollama's model runner is the process this ADR MEASURED                                              |
| `cmd/obsidian-memoryd` — every `git` child    | `CREATE_NO_WINDOW`  | git spawns `git-remote-https` / credential helpers; the daemon syncs on its own schedule            |

Decision, unchanged in substance and now uniform: a spawn that can have console-subsystem
descendants goes through the launcher. `CREATE_NO_WINDOW` stays legal only for a **leaf**
(the OTLP sink, `icacls`, `tar -xf`, `obscura --version`), where there is no grandchild for
Windows to hand a new console to.

Made structural rather than remembered:

- `console.go` / `console_windows.go` / `console_other.go` moved from `cmd/vkm-runhidden/`
  into `internal/winconsole/`, so the daemon and the launcher share one implementation
  instead of two opposite ones. `runWatch` calls `winconsole.HideOwnConsole()` once — and
  only there, because the CLI subcommands run in the user's own terminal.
- `hidden-console.mjs` moved into `@vkmikc/vkm-core`, so every package can reach it.
- `packages/vkm-core/test/no-console-flash.test.mjs` fails on any new literal
  `windowsHide: true` outside a declared-leaf allowlist, and asserts the hot paths still
  route through the launcher.

## References

- `internal/winconsole/` — `console.go` (the ownership rule), `console_windows.go` (the syscalls),
  `console_other.go` (the no-op). Shared by both binaries.
- `cmd/vkm-runhidden/main.go` (transparency + `resolve`), `cmd/obsidian-memoryd/main.go` (`runWatch`).
- `packages/create-vkm-kit/src/hook-interpreter.mjs`, `src/runhidden-setup.mjs`
- `packages/vkm-core/src/hidden-console.mjs`, `packages/vkm-core/test/no-console-flash.test.mjs`
- `scripts/build-runhidden.mjs`, `scripts/check-runhidden-asset.mjs`, `scripts/install-runhidden.mjs`
- [ADR-0030](./0030-deterministic-enforcement-hooks.md), [ADR-0031](./0031-effort-gate-hook.md) — the
  guards whose exit codes this must not swallow.
