> [🇪🇸 Español](../es/troubleshooting.md) · 🇬🇧 English

# Troubleshooting

A calm, step-by-step reference for fixing problems with the **v3 kit** (the
`basic-memory` connection, optional hybrid search, and the optional always-on
HTTP server). Each entry follows the same shape: the **symptom** you see, the
**Cause**, and the exact **Fix** to type.

A few terms you will meet repeatedly:

- **MCP** (Model Context Protocol): the bridge that lets the AI agent inside
  Cursor read and write files in your Markdown vault.
- **stdio**: the simplest way to run that bridge — Cursor launches a small
  program on demand. No background server, no open port.
- **Streamable HTTP** (`url`): the alternative — a server you keep running, and
  Cursor talks to it over a network port on your own machine.
- **PATH**: the list of folders Windows searches when you type a command name.
  If a tool "is not recognized," it is usually missing from PATH.

If you are still setting things up, see the install guide
([`install.md`](./install.md)) and the sync guide ([`sync.md`](./sync.md)).
Common questions live in the [FAQ](./faq.md).

## Contents

- [MCP / Cursor](#mcp--cursor)
- [Git](#git)
- [Windows scheduled tasks](#windows-scheduled-tasks)
- [PowerShell](#powershell)
- [Network and ports](#network-and-ports)
- [Recovery](#recovery)

---

## MCP / Cursor

These are the problems you hit when the AI agent cannot reach your vault, or
when Cursor opens stray console windows.

### `uv` / `uvx` is not recognized (Windows)

**Cause.** `basic-memory` is started with the command `uvx basic-memory mcp`,
but **uv** is not installed, or it is installed but not on your PATH. (`uv` is a
small tool that downloads and runs Python programs; `uvx` is its "run this once"
launcher.)

**Fix.** Install uv from the official instructions:
[uv installation](https://docs.astral.sh/uv/getting-started/installation/).
Then close and reopen the terminal (or Cursor) so the new PATH takes effect, and
confirm it worked:

```powershell
uv --version
```

### `create-obsidian-memory` prints `Invalid JSON in mcp.json` even though the file looks fine

**Cause.** Some editors (and `Set-Content -Encoding utf8` in older PowerShell)
write an invisible marker called a **UTF-8 BOM** at the very start of
`mcp.json`. The JSON reader (`JSON.parse`) rejects that leading byte even though
everything else is valid.

**Fix.** The initializer (v3.0.0+) strips a leading UTF-8 BOM automatically
before merging. Re-run the non-interactive merge, or remove the BOM by hand:
re-save the file as **UTF-8 without BOM**, or delete the first invisible
character at the top.

### Cursor MCP panel: `basic-memory` shows red / "not available"

This one has several possible causes. Work through them top to bottom.

| Cause                                                                                                                                                                | Fix                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **`uv` / `uvx` is missing** from the PATH Cursor uses, or the first cold `uvx` download is still running (**20–40 s** the first time).                               | Install uv, restart Cursor, and wait once. See [`uv` / `uvx` is not recognized](#uv--uvx-is-not-recognized-windows) above. |
| **`BASIC_MEMORY_HOME`** points at a folder that does not exist or cannot be read. (`BASIC_MEMORY_HOME` is the setting that tells the bridge where your vault lives.) | Set an **absolute** path to your vault root in `mcp.json`, then re-merge a known-good entry (command below).               |
| You use **`url`** (Streamable HTTP) but nothing is listening on that port.                                                                                           | Start the listener (see the sync guide) **or** switch to **stdio** (`command` + `uvx`).                                    |

To re-merge a known-good `basic-memory` entry, replacing `<path>` with the full
path to your vault:

```powershell
npx @vkmikc/create-obsidian-memory "<path>" -y
```

### `mcp.json` lost my Linear / Supabase entries

**Cause.** A previous setup run **overwrote** the file instead of **merging**
into it. (Merging keeps your existing entries and only adds or updates the
kit's own.)

**Fix.** Restore from the automatic backup `mcp.json.bak`. The current
initializer (`create-obsidian-memory`) always makes that backup first and
merges; only much older v1-era scripts could clobber the file. See the
[Recovery](#recovery) section for the full reset.

### Cursor log: `Transient error connecting to streamableHttp server: fetch failed`

**Cause.** `mcp.json` uses a **`url`** (Streamable HTTP) for `basic-memory`, but
**nothing valid is listening** on that host and port. Either the listener has
not been started, it crashed, or **another unrelated program already grabbed the
port** — in that last case the network connection "succeeds" but the MCP request
still fails.

**Fix.** Start the HTTP listener the way you configured it (see the sync guide).
For example, a **minimized terminal** running:

```powershell
uvx basic-memory mcp --transport streamable-http
```

Confirm the listener is really **basic-memory** and not some other program. List
who owns the port (`8765` is the default), then check that process:

```powershell
netstat -ano | findstr :8765
```

That prints a **PID** (the number identifying the process). Look up that PID's
program name in Task Manager. If the default port is taken by something else,
pick a free high port (for example **8877**) and set the **same** value in
**both** the listener command **and** in `mcp.json`:

```json
"url": "http://127.0.0.1:8877/mcp"
```

If you do not actually need a persistent server, switch back to **stdio**
(`command` + `uvx`) instead.

> **`ECONNREFUSED` right after editing `mcp.json`.** Cursor may try to reconnect
> **before** the first cold `uvx` start has finished (it can take **20–40 s**).
> Wait, start the listener, then run **Developer: Reload Window** from Cursor's
> command palette.

### Cursor: `basic-memory` red with URL `http://127.0.0.1:…/mcp`

**Cause.** The `basic-memory` HTTP server is not running, or the **port is taken
by another app** (the network layer may "open" while MCP still fails with
`fetch failed`).

**Fix.** Start the HTTP listener as in the sync guide (a minimized terminal, or
a task **you** defined yourself). Confirm the PID owning the port belongs to
`basic-memory` / `uv`:

```powershell
netstat -ano | findstr :8765
```

If the default port is taken, choose another (for example **8877**) and use the
**same** value in both the startup command and `mcp.json`.

### Toast: `Failed to open resource: memory://...`

**Cause.** Cursor tried to open **native / virtual "memory"** content (the
`memory://` scheme), not a real file in your Markdown vault. The link is
probably stale, or that resource no longer exists.

**Fix.** Close the notification. If it keeps reappearing, run **Developer:
Reload Window**. To open vault notes, use the MCP tools (`read_note`,
`write_note`, and so on). This is **not** caused by git autosync on its own.

### A big console window flashes when syncing or starting the MCP

**Cause.** The `obsidian-memoryd` binary was built as a **console** app (without
the `-H windowsgui` flag), or its `git` subprocesses do not carry the
`CREATE_NO_WINDOW` flag (this is pre-v3 behaviour).

**Fix (v3 kit).** Build it as a windowless app:

```bash
go build -ldflags="-H windowsgui" -o bin/obsidian-memoryd.exe ./cmd/obsidian-memoryd
```

The repo includes `proc_windows.go`, which adds `CREATE_NO_WINDOW + HideWindow`
to every `git` subprocess, removing the flash even when launched from a
windowsgui executable. See the sync guide for details.

### Many CMD windows / a black console when opening Cursor or refreshing MCP

**Cause (common).** Cursor launches MCP processes defined with **`command`**
(for example **`node`** for `obsidian-memory-hybrid`, or **`uvx`** / **`npx`**)
on every connection or **retry**; on Windows that can briefly show a console
window.

**Cause (HTTP `basic-memory`).** After a config change or a restart, Cursor may
try to connect **before** the listener exists, logging `ECONNREFUSED`; the
retries then chain into more console-spawning MCP launches.

**Fix.** Start the HTTP listener and wait **20–40 s** the first time (`uvx`
downloads on first use), then run **Developer: Reload Window**. For **fewer
windows**, disable MCP servers you do not use, or run **`basic-memory` over
stdio**.

**To diagnose,** open **Task Manager → Details** (turn on the command-line
column) or **Resource Monitor** while the problem is happening, so you can see
exactly which program is opening the windows.

### A `conhost` window appears every few seconds, with `git` as its parent (Windows)

**Prevention (kit).** This repo and the example vault ship a
**`.vscode/settings.json`** that turns off `git.autorefresh` / `git.autofetch`
and excludes folders from the file **watcher** (including `.obsidian/`).
Cursor / VS Code apply those settings when you open the folder as a workspace.
The initializer **`@vkmikc/create-obsidian-memory`** **creates or merges**
`<vault>/.vscode/settings.json` when you pass `--vault` (the kit's Git/SCM keys
are updated; any other keys of yours are kept).

**Cause.** Something — almost always the **IDE's source-control feature** or an
extension like **GitLens** — runs **`git.exe`** in a loop (`status`, diffs, and
so on). On Windows many of those calls spawn a **`conhost.exe`** as a child of
**`git`**. Seeing **dozens** of `conhost` windows usually means **many IDE
windows are open**, **many folders are open at once**, or processes are not
closing cleanly.

**Fix.** Open the repo / vault as a **top-level folder** so it loads
`.vscode/settings.json`. If you already have your own `settings.json`, copy the
`git.*` and `files.watcherExclude` keys from the kit's example. Review heavy Git
extensions and **close** duplicate windows pointing at the same repo.

### A pop-up titled `git.exe` or `…\Git\bin\sh.exe` steals focus

**Cause.** Something (Cursor's source control, an extension, or a task) is
launching **`…\Git\bin\git.exe`** or **`bin\sh.exe`** in a **separate console**.
That is typical of Git for Windows when the wrong git executable is used instead
of the **`cmd\git.exe`** meant for graphical programs.

**Fix.** In **Settings → JSON** (user or workspace), point Git at the right
executable and turn off terminal authentication:

```json
"git.path": "C:\\Program Files\\Git\\cmd\\git.exe",
"git.terminalAuthentication": false
```

Adjust the path if your Git is portable or on another drive — find it with:

```powershell
where.exe git
```

The kit **merges** both of these keys when you run `create-obsidian-memory` with
`--vault` on Windows, provided it finds `cmd\git.exe`. Afterwards, run
**Developer: Reload Window**.

> The **exit code 0 or 1** shown in the "process finished" message is a
> side detail; the real problem is the **window** that steals focus from your
> game or editor.

### `npx -y mcp-remote` is very slow the first time

**Cause.** The `npx` cache is empty, so the first cold install takes around
**30 seconds**. (`npx` runs Node packages; the first run downloads them.)

**Fix.** Wait once. Every call after that is nearly instant.

---

## Git

These cover the `git` errors you may see while syncing the vault. The safe order
for syncing is always: `git add -A` → commit (only if needed) →
`git pull --rebase` → `git push`.

### `cannot pull with rebase: You have unstaged changes`

**Cause.** Something ran `git pull --rebase` while the working folder still had
**unstaged changes** (edits Git has not been told to include yet). The safe
order is `git add -A` → commit (only if needed) → `pull --rebase` → `push`. A
manual `git pull --rebase`, or an automation, skipped the add/commit steps.

**Fix.** Follow the canonical order: `add -A` → `commit` → `pull --rebase` →
`push`. See the sync guide.

### `Author identity unknown`

**Cause.** Git has no `user.name` or `user.email` configured, so it cannot stamp
your commits.

**Fix.** Set them once (replace with your own name and email):

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Run this before your first commit on any new vault or machine.

### `git ls-remote <url>` hangs prompting for credentials

**Cause.** There is no **Git Credential Manager** (GCM) to supply your login.
Modern Git for Windows installers bundle GCM by default, but older or custom
installs can skip it.

**Fix.** Reinstall Git for Windows with the GCM option enabled, or run the
command below, which configures GCM for you:

```powershell
gh auth login
```

### `Repository not found` from `ls-remote`

**Cause.** The repository URL is wrong, the repository does not exist, or your
account does not have access to it.

**Fix.** Open the URL in your browser while signed in to confirm it is correct.
If the address is wrong, inspect and fix the `origin` remote:

```powershell
git remote -v
git remote set-url origin <correct-url>
```

### `error: failed to push some refs to ...` after a successful `pull --rebase`

**Cause.** Two machines pushed at almost the same time (a push "race").

**Fix.** If you use Task Scheduler for git, wait for the next run or sync by hand.
Otherwise run a fresh pull then push from the integrated terminal:

```powershell
git pull
git push
```

See the sync guide for the scheduled-sync option.

---

## Windows scheduled tasks

This section applies **only if you chose** to run a Windows scheduled task (for
git sync or an always-on HTTP server). With plain **stdio** `basic-memory` you
do not need any of this.

> **Note on copy-paste templates.** The current kit guides **do not** ship
> ready-made `schtasks` templates. Prefer **stdio** `basic-memory` plus
> **manual git** or **`obsidian-memoryd watch`**.

### `ERROR: The system cannot find the file specified` after `schtasks /Create`

**Cause.** A quoting problem in the `/TR` argument (the command the task runs),
or the program path inside the task does not exist.

**Fix.** Wrap the `/TR` argument in double quotes and run it through `cmd /c` so
PowerShell does not re-interpret the inner quotes. Then check the command line in
**Task Scheduler → your task → Actions**.

### A console window appears every few minutes (scheduled-task cadence)

**Cause.** The task runs **`powershell.exe`** or **`cmd.exe`** in a way that
shows a window on each run.

**Fix.** Edit the task in `taskschd.msc` — choose a different program, weigh
"run whether user is logged on or not" against the interactive option, or
disable the task. Better still, prefer **stdio** `basic-memory` with **manual
git** or **`obsidian-memoryd watch`** instead of a custom scheduled shell. If the
task still runs too often, increase its interval.

### A scheduled task shows a non-zero "last result"

**Cause.** The task's action failed — bad Git credentials, a merge conflict, a
wrong path, or the HTTP MCP server not being up yet. (A "last result" other than
`0` means the command ended in an error.)

**Fix.** Open **Task Scheduler → your task → History**, or run the command line
shown under **Actions** by hand in a terminal to see the real error. For git-sync
and HTTP `basic-memory` options, see the sync guide.

---

## PowerShell

Windows ships with **Windows PowerShell 5.1** (`powershell.exe`). Several modern
features only exist in **PowerShell 7+** (`pwsh`), which is a separate install —
so scripts that must run everywhere have to avoid them.

### `El token '&&' no es un separador de instrucciones válido en esta versión`

(The message means: "`&&` is not a valid statement separator in this version.")

**Cause.** PowerShell 5.1 does not support `&&` or `||` as separators between
commands. Only PowerShell 7+ does.

**Fix.** Chain commands with `;` and check `$?` (did the last command succeed?)
or `$LASTEXITCODE` (the last program's exit code) after each one:

```powershell
git add -A; if (-not $?) { throw "git add failed" }
git commit -m "x"; if ($LASTEXITCODE -ne 0) { throw "commit failed" }
```

### `ConvertFrom-Json: A parameter cannot be found that matches parameter name 'AsHashtable'`

**Cause.** The `-AsHashtable` option exists only in PowerShell 7+. Legacy scripts
and CI helpers must also work on 5.1, where it is unavailable.

**Fix.** Use plain `ConvertFrom-Json`, and apply `[pscustomobject]` at the point
where you build the output. See ADR-0005 for the canonical pattern.

### `The variable 'X' cannot be retrieved because it has not been set`

**Cause.** `Set-StrictMode -Version Latest` is on (a mode that makes PowerShell
stricter), and you tried to read a property that does not exist on a
`[pscustomobject]`.

**Fix.** Loop over the object's properties with `$obj.PSObject.Properties`
instead of reading them by dotted name, or give the property a starting value
before you read it.

### `the term 'pwsh' is not recognized`

**Cause.** PowerShell 7 (`pwsh`) is not installed. CI and legacy scripts target
Windows PowerShell 5.1 — the `powershell.exe` that already ships with Windows.
Some users see this when running the CI extractor script without PS7.

**Fix.** For the install itself you do **not** need `pwsh`. For local CI, install
PowerShell 7:

```powershell
winget install --id Microsoft.PowerShell
```

---

## Network and ports

### `obsidian-memoryd` shows push/pull failing while offline

**Cause.** No network is reachable, so the debounced git sync (the background
sync that waits for quiet moments) cannot reach the remote.

**Fix.** None needed — it retries on the next cycle once the network is back.
Check its health any time with:

```powershell
obsidian-memoryd doctor
```

That reports the heartbeat age, the last successful push, and the count of
consecutive failures.

---

## Recovery

If your install is in a confusing state, reset it in this order. **None of these
steps delete your notes** — your Markdown files live in git, and nothing here
removes vault content unless you explicitly delete folders yourself.

1. **MCP config.** Back up the file, then re-merge a known-good `basic-memory`
   entry (replace `<absolute-vault-path>` with your vault's full path):

   ```powershell
   npx @vkmikc/create-obsidian-memory "<absolute-vault-path>" -y
   ```

   The file to back up first is `%USERPROFILE%\.cursor\mcp.json`. This restores a
   working `basic-memory` entry. See the [install guide](./install.md).

2. **Workspace Git noise (Windows).** Make sure the vault is opened as a
   **folder** so `vault/.vscode/settings.json` takes effect, then re-run the same
   command to merge the kit's keys.

3. **Manual checks.** Run the MCP smoke checks from the project's manual-checks
   document to confirm the agent can reach the vault.

4. **Optional Windows tasks / HTTP listener.** Only if you chose those options,
   follow the sync guide. They are **not** required for stdio `basic-memory`.

5. **Hard local reset (Windows).** Back up `%USERPROFILE%\.cursor\mcp.json`, then
   in `taskschd.msc` delete or disable any `Cursor*` tasks you no longer want,
   and re-merge MCP with the command from step 1. Do **not** delete the vault
   unless you decide to.

> Your Markdown files stay in **git**. Nothing in this section deletes vault
> content unless you explicitly remove folders or run a destructive script you
> chose to run yourself.

---

See also: [install guide](./install.md) · [sync guide](./sync.md) ·
[FAQ](./faq.md).
