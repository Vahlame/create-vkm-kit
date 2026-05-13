# Windows: git-backed vault without stutter or pop-up consoles while gaming

Goal: **refresh memory** (vault pull/push) when you want, without **disk/Git spikes** or **CMD/console** windows stealing focus from fullscreen games.

## Principle

Separate **“when I sync”** from **“when I play”**:

1. **Less background automation** — prefer [`obsidian-memoryd watch`](../../cmd/obsidian-memoryd) or **manual git**; see [`windows-scheduled-vault-sync.en.md`](./windows-scheduled-vault-sync.en.md).
2. **Less IDE polling** (only while you work in the vault with Cursor open): vault `.vscode/settings.json`.
3. If you use **Task Scheduler**, inspect actions in `taskschd.msc` so they do not spawn unnecessary consoles. This kit does **not** publish script templates to copy.

Cursor + vault open in the same session as a competitive game is still **heavy** (Git, extensions, MCP). Cleanest: **close Cursor** while playing, or do not open the vault folder until you are done.

## 1. Task Scheduler (if you use it)

- Raise the interval or disable tasks you do not need during a match.
- Avoid **two** different automations hammering `git` at the same cadence.

**Pause tasks before playing** (adjust names to match yours):

```powershell
Get-ScheduledTask -TaskName 'CursorMemoryVaultSync','CursorBasicMemoryHttpMcp' -ErrorAction SilentlyContinue |
  Disable-ScheduledTask
```

**Re-enable after:**

```powershell
Get-ScheduledTask -TaskName 'CursorMemoryVaultSync','CursorBasicMemoryHttpMcp' -ErrorAction SilentlyContinue |
  Enable-ScheduledTask
```

## 2. Cursor and the vault

- With the vault opened as a folder, rely on **`.vscode/settings.json`** (template under `examples/.vscode/` or merged by `create-obsidian-memory`) for calmer Git polling.
- **MCP:** fewer enabled servers → fewer background processes.
- **Serious gaming:** close Cursor or do not open the vault in that session.

## 3. Focus steal (fullscreen)

- **`conhost` / console flashes** while gaming are often **Cursor, extensions, IDE Git**, or **another app** (launcher, overlay, AV). Use **Task Manager** → **Details** (command line) while reproducing.

## 4. Network and disk

- Large git syncs can **spike disk** for a few seconds; longer intervals or syncing after the match reduces stutter.

## Summary

| Situation                              | What to do                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| Stay up to date without bothering play | Fewer tasks / longer intervals / **Disable** before play and **Enable** after.      |
| Less lag with Cursor open              | Vault `.vscode` + **fewer MCP/extensions**; ideally **no** Cursor during the match. |
| Fewer CMD flashes                      | Calmer Git IDE settings; inspect your own tasks in `taskschd.msc`.                  |

More context: [`windows-sin-consola-visible.en.md`](./windows-sin-consola-visible.en.md).
