# Windows: keep the git-backed vault updated without lag or focus-stealing shells while gaming

Goal: **refresh memory** (vault pull/push) when you want, but avoid **Git/disk spikes** and **CMD/console windows** that steal focus from fullscreen games.

## Principle

Separate **when you sync** from **when you play**:

1. **Lower automatic frequency** (Task Scheduler).
2. **Lower IDE polling** (only when Cursor has the vault folder open).
3. **Never run scheduled tasks via bare `powershell.exe`/`cmd.exe`** (always `wscript` + `Run-Hidden.vbs`).

Cursor + vault open on the same desktop as a competitive game is still heavy (Git, extensions, MCP). The cleanest approach: **close Cursor** while gaming, or do not open the vault folder until you finish.

## 1. Task Scheduler (every-X-minutes sync)

- Increase the interval (e.g. from a legacy **10-minute** task to **60–120 minutes**) or rely on **manual** sync / `obsidian-memoryd watch` with debounce.
- Avoid **two** tasks hammering `git` on the same cadence.
- Audit actions with  
  `.\scripts\windows\Get-CursorScheduledTaskConsoleRisk.ps1`  
  (it should flag direct console launches).

**Pause tasks before a session** (usually no admin required if you created them):

```powershell
Get-ScheduledTask -TaskName 'CursorMemoryAutoSync','CursorMemoryVaultSync','CursorObsidianMcpWatchdog' -ErrorAction SilentlyContinue |
  Disable-ScheduledTask
```

**Re-enable afterwards:**

```powershell
Get-ScheduledTask -TaskName 'CursorMemoryAutoSync','CursorMemoryVaultSync','CursorObsidianMcpWatchdog' -ErrorAction SilentlyContinue |
  Enable-ScheduledTask
```

Adjust task names to match `taskschd.msc`.

## 2. Cursor and the vault

- Open the vault as a folder and keep **`.vscode/settings.json`** (template in `examples/.vscode/` or written by `create-obsidian-memory`) so Git SCM is not hyperactive.
- **MCP:** fewer enabled servers → fewer background processes.
- **Serious gaming:** quit Cursor or do not open the vault in that session.

## 3. Focus stealing (fullscreen)

- Tasks wired through `wscript` + `Run-Hidden.vbs` **should not** flash a window.
- If you still see **conhost**/console while gaming, it is often **another app** (launcher, overlay, AV) — capture evidence with  
  `tools/monitor-console-live.ps1` **while** it happens (parent + `CommandLine`).

## 4. Disk spikes

- Large `git` syncs can **hit disk** for a few seconds; longer intervals or syncing **after** gaming reduces stutter.

## Summary

| Need                                        | Action                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Up-to-date vault without bothering gameplay | **Longer** task intervals or **Disable** tasks before play, **Enable** after.   |
| Less lag with Cursor open                   | Vault `.vscode` + **fewer MCP/extensions**; best: **no** Cursor during matches. |
| No CMD flashes                              | Hidden task launchers + calm Git settings; use the audit script above.          |

See also [`windows-sin-consola-visible.en.md`](./windows-sin-consola-visible.en.md).
