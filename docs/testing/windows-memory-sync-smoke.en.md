# Windows: quick smoke (memory, git, MCP)

Checklist **after** you have the vault, `basic-memory` in Cursor, and any automation **you configured** (e.g. `obsidian-memoryd`, HTTP in a terminal — see [`../setup/windows-scheduled-vault-sync.en.md`](../setup/windows-scheduled-vault-sync.en.md) and [`../setup/windows-basic-memory-always-on.en.md`](../setup/windows-basic-memory-always-on.en.md)).

## 1. Scheduled tasks (if any)

```powershell
Get-ScheduledTask -TaskName CursorMemoryVaultSync,CursorBasicMemoryHttpMcp -ErrorAction SilentlyContinue |
  Select-Object TaskName, State
```

**Ready** is expected. If you do not use tasks, these may return nothing.

## 2. Last run and exit code

```powershell
@(
  'CursorMemoryVaultSync'
  'CursorBasicMemoryHttpMcp'
) | ForEach-Object {
  $i = Get-ScheduledTaskInfo -TaskName $_ -ErrorAction SilentlyContinue
  if (-not $i) { return }
  [pscustomobject]@{
    TaskName       = $_
    LastRunTime    = $i.LastRunTime
    LastTaskResult = $i.LastTaskResult
  }
} | Format-Table -AutoSize
```

For many user tasks, **`LastTaskResult` 0** means success. Otherwise open the task in `taskschd.msc` and inspect **Actions**; see [`../troubleshooting.md`](../troubleshooting.md).

## 3. Task actions (manual review)

In **Task Scheduler** → task → **Actions**: confirm program/arguments match your intent (e.g. `cmd.exe` + `uvx …` for HTTP, or the `obsidian-memoryd` `.exe`). This repo does not ship a single canonical task template.

## 4. Git in the vault

```powershell
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
Push-Location $vault
try {
  git status -sb
  git remote get-url origin
} finally { Pop-Location }
```

Confirm **`origin`** exists if you expect `push` to work.

## 5. Manual sync once (optional)

In a terminal at the vault root:

```bash
git add -A
git status
git commit -m "smoke"   # only if there are changes
git pull --rebase
git push
```

## 6. HTTP `basic-memory` MCP (default port **8765**)

If `mcp.json` uses `http://127.0.0.1:8765/mcp`, start the listener first (terminal `uvx …` per the always-on guide):

```powershell
Test-NetConnection 127.0.0.1 -Port 8765 -InformationLevel Quiet
```

`True` means something is listening on that port.

## 7. Local FTS5 (optional, public repo clone)

Index and BM25 search on the vault:

```powershell
$repo = "C:\path\to\cursor-obsidian-memory-guide"
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
pip install -e "$repo\packages\obsidian-memory-rag"
obsidian-memory-rag index --vault $vault
obsidian-memory-rag search --vault $vault "MEMORY"
```

If **`obsidian-memory-rag` is not on PATH** after `pip install -e`, use the module:

```powershell
Set-Location "$repo\packages\obsidian-memory-rag"
python -m obsidian_memory_rag index --vault $vault
python -m obsidian_memory_rag search --vault $vault "MEMORY"
```

More detail: [`manual-checks.md`](./manual-checks.md) (sections 6–7) and hybrid MCP at [`../../config/mcp/obsidian-memory-hybrid.json`](../../config/mcp/obsidian-memory-hybrid.json).

## 8. Monorepo (contributors / local CI)

In the **cursor-obsidian-memory-guide** clone:

```powershell
npm install
npm run sync-agents:check
npm run eval:adherence
npm test
```

Under `packages/obsidian-memory-rag`: `python -m pytest tests/ -q`.

## Spanish

Same checklist: [`windows-memory-sync-smoke.md`](./windows-memory-sync-smoke.md).
