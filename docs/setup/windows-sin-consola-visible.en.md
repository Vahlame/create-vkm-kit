# Windows: avoid visible console (CMD) windows with Cursor

Goal: **fewer console flashes** without relying on kit-shipped scripts. Typical causes are **IDE (Git / extensions)**, **MCP (`node`, `uvx`, `npx`)**, and **Task Scheduler** entries that invoke `powershell.exe` or `cmd.exe` directly.

## 1. Always open the correct folder (workspace)

Repository defaults live in **`.vscode/settings.json`**. They apply only when you open the **repository or vault root** (**File → Open Folder**), not a single loose file.

After pulling updates: **Developer: Reload Window** once.

## 2. Workspace settings (shipped with this kit)

At the repo root (and in vaults via `create-obsidian-memory` or `examples/.vscode/`) we disable aggressive Git polling and several SCM decorations, and exclude noisy paths from the file watcher (including `.obsidian/` and build caches). We also set **`git.terminalAuthentication`: false** so Git auth does not insist on a dedicated terminal window.

If you see windows titled **`…\Git\bin\git.exe`** or **`bin\sh.exe`**, set in **User** or **workspace** JSON: **`"git.path": "C:\\Program Files\\Git\\cmd\\git.exe"`** (the **`cmd\git.exe`** launcher, not **`bin\git.exe`**). On Windows the kit initializer tries to write `git.path` when merging the vault if that file exists.

If you need live Git UI in **this** folder, edit **your** `.vscode/settings.json` and set `git.autorefresh` back to `true` (accepts more `git`/`conhost` traffic).

## 3. `Cursor*` scheduled tasks (if you created any)

Open **Task Scheduler** (`taskschd.msc`) → your tasks whose names start with `Cursor` → **Actions** tab. If the program is **`powershell.exe`** or **`cmd.exe`** without “start minimized” (where applicable), Windows may flash a console when the task fires. Change the action, or disable the task when you do not need it.

This repo does **not** publish VBS/PowerShell templates to hide the console.

## 4. MCP and extensions

- Each MCP server launched with **`command`** (`uvx`, `node`, `npx`) may create a **console** on Windows; this repository cannot fully suppress that. Reduce enabled MCP servers under **Settings → MCP** and disable extensions that repeatedly spawn Git or shells (try without GitLens as a test).
- Diagnostics: **Task Manager** → **Details** (command-line column) or **Resource Monitor** while reproducing the issue.

## 5. Honest limit

There is **no** Markdown switch that guarantees **zero** windows for **every** mix of extensions, MCP, and OS tasks. This kit ships **workspace defaults + guidance** to get close to “no flashes” for normal vault + repo workflows.

## 6. `obsidian-memoryd` without a console window (optional)

If you run **`obsidian-memoryd watch`** on Windows, build with **`go build -ldflags="-H windowsgui"`** so the `.exe` is a **GUI-subsystem** binary (no `conhost`). Avoid wrapping in `cmd.exe` if you dislike flashes: a **Startup shortcut** to the `.exe` with args `watch` and **Start in** = vault root works (the daemon uses cwd as the vault when `BASIC_MEMORY_HOME` is unset). Tune cadence with **`OBSIDIAN_MEMORY_DEBOUNCE`** (e.g. `2m`). More detail: [`windows-scheduled-vault-sync.en.md`](./windows-scheduled-vault-sync.en.md).

**Fullscreen gaming + vault sync:** [`windows-juego-vault-sync.en.md`](./windows-juego-vault-sync.en.md).
