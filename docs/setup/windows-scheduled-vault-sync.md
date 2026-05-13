# Windows: sincronizar el vault con git a intervalos

Si no quieres instalar **Go** para `obsidian-memoryd watch`, puedes usar una **tarea programada** que ejecute un script PowerShell ya en tu vault (o equivalente).

## Requisitos

- Vault con **`.git`** y remoto `origin` configurado (HTTPS o SSH con credencial guardada).
- Script recomendado: `scripts/windows/Sync-Memory.ps1` en el repo del vault (orden: `git add -A` → `commit` si hay cambios → `pull --rebase` → `push`).

## Sin ventana de consola (recomendado)

Aunque uses `-WindowStyle Hidden` en `powershell.exe`, a veces **sí** aparece un flash de ventana. El patrón estable es **`wscript.exe`** + un `.vbs` mínimo que lanza PowerShell con ventana oculta (igual que el shim v1 del vault).

Copia `Run-Hidden.vbs` junto a tus scripts (en el repo público: `scripts/windows/Run-Hidden.vbs`; en el vault: `scripts/windows/Run-Hidden.vbs`).

## Crear la tarea (cada **60 minutos** por defecto, usuario actual)

**Por qué 60 min:** un vault de memoria no necesita `pull`/`push` en bucle corto; intervalos agresivos (5–10 min) generan ruido en red, disco y a veces ventanas de consola. Para equipos multi-máquina muy activos, **15–30 min** es un compromiso razonable; reserva **5 min** solo para depuración.

Ajusta `$vault` si tu ruta no es la habitual. Para otro intervalo, cambia el número en **`-RepetitionInterval (New-TimeSpan -Minutes 60)`** y la descripción.

```powershell
$vault = "$env:USERPROFILE\Documents\cursor-memory-vault"
$vbs = Join-Path $vault "scripts\windows\Run-Hidden.vbs"
$script = Join-Path $vault "scripts\windows\Sync-Memory.ps1"
$arg = "//nologo `"$vbs`" `"$script`""
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument $arg
$start = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $start `
  -RepetitionInterval (New-TimeSpan -Minutes 60) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Unregister-ScheduledTask -TaskName "CursorMemoryVaultSync" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "CursorMemoryVaultSync" -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description "Git sync vault cursor-memory-vault cada 60 min (sin ventana)"
```

### Probar una vez a mano

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Documents\cursor-memory-vault\scripts\windows\Sync-Memory.ps1"
```

### Ver estado

```powershell
Get-ScheduledTask -TaskName "CursorMemoryVaultSync"
```

### Quitar la tarea

```powershell
Unregister-ScheduledTask -TaskName "CursorMemoryVaultSync" -Confirm:$false
```

## Alternativa: `obsidian-memoryd` (Go)

Sincronización **al guardar** (debounce **45 s** por defecto; opcional `OBSIDIAN_MEMORY_DEBOUNCE`, p. ej. `90s` o `2m`): requiere instalar Go, compilar desde este repo (`go build -o obsidian-memoryd ./cmd/obsidian-memoryd`) y ejecutar `obsidian-memoryd watch` con `BASIC_MEMORY_HOME` apuntando al vault. En Windows se puede registrar como servicio con `obsidian-memoryd service install` (ver `cmd/obsidian-memoryd/main.go` y `agent.toml`).

## English

Same content: [`windows-scheduled-vault-sync.en.md`](./windows-scheduled-vault-sync.en.md).
