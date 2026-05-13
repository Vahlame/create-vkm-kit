# Windows: quick smoke (memory, autosync, extras)

Run **after** you set up the vault, `basic-memory` in Cursor, and (optional) scheduled tasks `CursorMemoryVaultSync` / `CursorBasicMemoryHttpMcp` per [`../setup/windows-scheduled-vault-sync.en.md`](../setup/windows-scheduled-vault-sync.en.md) and [`../setup/windows-basic-memory-always-on.en.md`](../setup/windows-basic-memory-always-on.en.md).

Adjust `$vault` if your path differs.

## 1. Scheduled tasks registered

```powershell
Get-ScheduledTask -TaskName CursorMemoryVaultSync,CursorBasicMemoryHttpMcp,CursorObsidianMemorydWatch -ErrorAction SilentlyContinue |
  Select-Object TaskName, State
```

**Ready** is expected. **Running** may show briefly while the trigger fires.

## 2. Last run time and exit code

```powershell
@(
  'CursorMemoryVaultSync'
  'CursorBasicMemoryHttpMcp'
  'CursorObsidianMemorydWatch'
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

For many per-user tasks, **`LastTaskResult` 0** means success. If not, check script logs or [`../troubleshooting.md`](../troubleshooting.md).

## 3. No-console launcher (sync / MCP)

```powershell
$t = Get-ScheduledTask -TaskName CursorMemoryVaultSync -ErrorAction SilentlyContinue
if ($t) { $t.Actions | Format-List Execute, Arguments }
```

Recommended pattern: **`wscript.exe`**, arguments containing **`Run-Hidden.vbs`** and the vault `.ps1` (copy from [`../../scripts/windows/Run-Hidden.vbs`](../../scripts/windows/Run-Hidden.vbs)).

## 4. Git in the vault

```powershell
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
Push-Location $vault
try {
  git status -sb
  git remote get-url origin
} finally { Pop-Location }
```

Confirm **`origin`** exists if you want automatic push.

## 5. Run sync once (optional)

From an already-open terminal (you will see a window here; the scheduled task using VBS should not flash):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Documents\cursor-memory-vault\scripts\windows\Sync-Memory.ps1"
```

To fire only the task (no window if the action is `wscript` + VBS):

```powershell
Start-ScheduledTask -TaskName CursorMemoryVaultSync
```

## 6. HTTP MCP `basic-memory` (port 8000)

If you use **CursorBasicMemoryHttpMcp** and `mcp.json` with `http://127.0.0.1:8000/mcp`:

```powershell
Test-NetConnection 127.0.0.1 -Port 8000 -InformationLevel Quiet
```

`True` means something is listening.

## 7. Local FTS (optional, public repo cloned)

Index and BM25 search on the vault:

```powershell
$repo = "C:\path\to\cursor-obsidian-memory-guide"
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
pip install -e "$repo\packages\obsidian-memory-rag"
obsidian-memory-rag index --vault $vault
obsidian-memory-rag search --vault $vault "MEMORY"
```

If **`obsidian-memory-rag` is not on PATH** after `pip install -e`, call the module:

```powershell
Set-Location "$repo\packages\obsidian-memory-rag"
python -m obsidian_memory_rag index --vault $vault
python -m obsidian_memory_rag search --vault $vault "MEMORY"
```

More detail: [`manual-checks.md`](./manual-checks.md) (sections 6–7) and hybrid MCP [`../../config/mcp/obsidian-memory-hybrid.json`](../../config/mcp/obsidian-memory-hybrid.json).

## 8. Monorepo (contributors / local CI)

In your **cursor-obsidian-memory-guide** clone:

```powershell
npm install
npm run sync-agents:check
npm run eval:adherence
npm test
```

In `packages/obsidian-memory-rag`: `python -m pytest tests/ -q`.

## Spanish

Misma lista: [`windows-memory-sync-smoke.md`](./windows-memory-sync-smoke.md).
