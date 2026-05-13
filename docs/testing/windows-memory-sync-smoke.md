# Windows: smoke rápido (memoria, autosync y extras)

Checklist **después** de instalar el vault, `basic-memory` en Cursor y (opcional) tareas `CursorMemoryVaultSync` / `CursorBasicMemoryHttpMcp` según [`../setup/windows-scheduled-vault-sync.md`](../setup/windows-scheduled-vault-sync.md) y [`../setup/windows-basic-memory-always-on.md`](../setup/windows-basic-memory-always-on.md).

Ajusta `$vault` si tu ruta no es la habitual.

## 1. Tareas programadas registradas

```powershell
Get-ScheduledTask -TaskName CursorMemoryVaultSync,CursorBasicMemoryHttpMcp,CursorObsidianMemorydWatch -ErrorAction SilentlyContinue |
  Select-Object TaskName, State
```

**Ready** es lo esperado. **Running** puede aparecer unos segundos mientras corre el trigger.

## 2. Última ejecución y código de salida

```powershell
@(
  'CursorMemoryVaultSync'
  'CursorBasicMemoryHttpMcp'
  'CursorObsidianMemorydWatch'
) | ForEach-Object {
  $i = Get-ScheduledTaskInfo -TaskName $_ -ErrorAction SilentlyContinue
  if (-not $i) { return }
  [pscustomobject]@{
    TaskName     = $_
    LastRunTime  = $i.LastRunTime
    LastTaskResult = $i.LastTaskResult
  }
} | Format-Table -AutoSize
```

Para muchas tareas de usuario, **`LastTaskResult` 0** indica éxito. Si ves otro valor, revisa el log del script o [`../troubleshooting.md`](../troubleshooting.md).

## 3. Lanzador sin ventana de consola (sync / MCP)

```powershell
$t = Get-ScheduledTask -TaskName CursorMemoryVaultSync -ErrorAction SilentlyContinue
if ($t) { $t.Actions | Format-List Execute, Arguments }
```

Patrón recomendado: programa **`wscript.exe`**, argumentos con **`Run-Hidden.vbs`** y el `.ps1` del vault (copia desde [`../../scripts/windows/Run-Hidden.vbs`](../../scripts/windows/Run-Hidden.vbs)).

## 4. Git en el vault

```powershell
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
Push-Location $vault
try {
  git status -sb
  git remote get-url origin
} finally { Pop-Location }
```

Comprueba que hay **remoto `origin`** si quieres push automático.

## 5. Probar sync una vez (opcional)

Desde una consola ya abierta (sí verás ventana aquí; la tarea programada con VBS no debería):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Documents\cursor-memory-vault\scripts\windows\Sync-Memory.ps1"
```

Para forzar solo la tarea (sin consola si la acción es `wscript` + VBS):

```powershell
Start-ScheduledTask -TaskName CursorMemoryVaultSync
```

## 6. MCP HTTP `basic-memory` (puerto por defecto **8765**)

Si usas la tarea **CursorBasicMemoryHttpMcp** y `mcp.json` con la misma URL (p. ej. `http://127.0.0.1:8765/mcp`):

```powershell
Test-NetConnection 127.0.0.1 -Port 8765 -InformationLevel Quiet
```

`True` indica que algo escucha en ese puerto.

## 7. FTS local (opcional, repo público clonado)

Índice y búsqueda BM25 sobre el vault (misma máquina):

```powershell
$repo = "C:\ruta\a\cursor-obsidian-memory-guide"
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
pip install -e "$repo\packages\obsidian-memory-rag"
obsidian-memory-rag index --vault $vault
obsidian-memory-rag search --vault $vault "MEMORY"
```

Si tras `pip install -e` el comando **`obsidian-memory-rag` no está en PATH**, usa el módulo:

```powershell
Set-Location "$repo\packages\obsidian-memory-rag"
python -m obsidian_memory_rag index --vault $vault
python -m obsidian_memory_rag search --vault $vault "MEMORY"
```

Más detalle: [`manual-checks.md`](./manual-checks.md) (secciones 6 y 7) y MCP híbrido en [`../../config/mcp/obsidian-memory-hybrid.json`](../../config/mcp/obsidian-memory-hybrid.json).

## 8. Monorepo (contribuidores / CI local)

En el clone de **cursor-obsidian-memory-guide**:

```powershell
npm install
npm run sync-agents:check
npm run eval:adherence
npm test
```

En `packages/obsidian-memory-rag`: `python -m pytest tests/ -q`.

## English

Same checklist: [`windows-memory-sync-smoke.en.md`](./windows-memory-sync-smoke.en.md).
