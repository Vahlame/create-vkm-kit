# Windows: avoid visible console (CMD) windows with Cursor

Goal: **not rely on restarting Cursor** for a clean desktop. Typical causes are three: **IDE (Git / extensions)**, **MCP (`node`, `uvx`, `npx`)**, and **Task Scheduler** entries that invoke `powershell.exe` or `cmd.exe` directly.

## 1. Always open the correct folder (workspace)

Repository defaults live in **`.vscode/settings.json`**. They apply only when you open the **repository or vault root** (**File → Open Folder**), not a single loose file.

After pulling updates: **Developer: Reload Window** once.

## 2. Workspace settings (shipped with this kit)

At the repo root (and in vaults via `create-obsidian-memory` or `examples/.vscode/`) we disable aggressive Git polling and several SCM decorations, and exclude noisy paths from the file watcher (including `.obsidian/` and build caches).

If you need live Git UI in **this** folder, edit **your** `.vscode/settings.json` and set `git.autorefresh` back to `true` (accepts more `git`/`conhost` traffic).

## 3. `Cursor*` scheduled tasks

If a task runs **`powershell.exe` / `cmd.exe` directly**, Windows may flash a console even if the interval is long.

1. Audit with the repo script (from the clone root):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Get-CursorScheduledTaskConsoleRisk.ps1
   ```

2. Rebuild actions using **`wscript.exe //nologo ...\Run-Hidden.vbs ...\YourScript.ps1`** as documented in [`windows-basic-memory-always-on.en.md`](./windows-basic-memory-always-on.en.md) and [`windows-scheduled-vault-sync.en.md`](./windows-scheduled-vault-sync.en.md).

## 4. MCP and extensions

- Each MCP server launched with **`command`** (`uvx`, `node`, `npx`) may create a **console** on Windows; this repository cannot fully suppress that. Reduce enabled MCP servers under **Settings → MCP** and disable extensions that repeatedly spawn Git or shells (try without GitLens as a test).
- Diagnostics: [`tools/monitor-console-live.ps1`](../../tools/monitor-console-live.ps1) (parent PID + truncated `CommandLine`).

## 5. Honest limit

There is **no** Markdown switch that guarantees **zero** windows for **every** mix of extensions, MCP, and OS tasks. This kit ships **workspace defaults + hidden scheduled-task pattern + guidance** to get close to “no flashes” for normal vault + repo workflows.
