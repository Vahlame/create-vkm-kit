# Windows: smoke rápido (memoria, git y MCP)

Checklist **después** de tener el vault, `basic-memory` en Cursor y cualquier automatismo **que hayas configurado tú** (p. ej. `obsidian-memoryd`, HTTP en terminal — ver [`../setup/windows-scheduled-vault-sync.md`](../setup/windows-scheduled-vault-sync.md) y [`../setup/windows-basic-memory-always-on.md`](../setup/windows-basic-memory-always-on.md)).

## 1. Tareas programadas (si existen)

```powershell
Get-ScheduledTask -TaskName CursorMemoryVaultSync,CursorBasicMemoryHttpMcp -ErrorAction SilentlyContinue |
  Select-Object TaskName, State
```

**Ready** es lo esperado. Si no usas tareas, no aparecerán filas.

## 2. Última ejecución y código de salida

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

Para muchas tareas de usuario, **`LastTaskResult` 0** indica éxito. Si ves otro valor, abre la tarea en `taskschd.msc` y revisa la línea de comando bajo **Acciones**; ver [`../troubleshooting.md`](../troubleshooting.md).

## 3. Acciones de la tarea (revisión manual)

En **Programador de tareas** → tarea → **Acciones**: confirma que el programa y los argumentos coinciden con lo que quieres (p. ej. `cmd.exe` + `uvx …` para HTTP, o el `.exe` de `obsidian-memoryd`). Este repo no define una plantilla única.

## 4. Git en el vault

```powershell
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
Push-Location $vault
try {
  git status -sb
  git remote get-url origin
} finally { Pop-Location }
```

Comprueba que hay **remoto `origin`** si quieres `push` al remoto.

## 5. Sync manual una vez (opcional)

En una terminal ya abierta en la raíz del vault:

```bash
git add -A
git status
git commit -m "smoke"   # solo si hay cambios
git pull --rebase
git push
```

## 6. MCP HTTP `basic-memory` (puerto por defecto **8765**)

Si `mcp.json` usa `http://127.0.0.1:8765/mcp`, primero arranca el listener (terminal con `uvx …` según la guía always-on):

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
