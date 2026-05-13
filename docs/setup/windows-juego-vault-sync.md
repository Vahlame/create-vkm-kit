# Windows: vault en git sin tirones ni ventanas durante el juego

Objetivo: **actualizar la memoria** (pull/push del vault) cuando quieras, pero que **no** haya picos de disco/Git ni **CMD/consolas** que quiten foco del juego a pantalla completa.

## Principio

Separar **“cuándo sincronizo”** de **“cuándo juego”**:

1. **Menos frecuencia automática** (Programador de tareas).
2. **Menos sondeo del IDE** (solo cuando trabajas en el vault con Cursor abierto).
3. **Nada que abra `powershell.exe`/`cmd.exe` a pelo** en tareas (siempre `wscript` + `Run-Hidden.vbs`).

Cursor + vault abierto en la misma sesión que un juego competitivo **sigue siendo pesado** (Git, extensiones, MCP). Lo más limpio: **cerrar Cursor** al jugar, o no abrir la carpeta del vault hasta terminar.

## 1. Programador de tareas (sync cada X min)

- Sube el intervalo (p. ej. de **10 min** —común en setups viejos— a **60–120 min**) o deja **solo** sync manual / `obsidian-memoryd watch` con debounce.
- Evita **dos** tareas que hagan `git` al mismo ritmo (redundancia = más I/O).
- Comprueba acciones con  
  `.\scripts\windows\Get-CursorScheduledTaskConsoleRisk.ps1`  
  (debe señalar riesgo si algo llama consola directa).

**Pausar tareas antes de jugar** (PowerShell como administrador no suele hacer falta; usuario actual basta si las creaste tú):

```powershell
Get-ScheduledTask -TaskName 'CursorMemoryAutoSync','CursorMemoryVaultSync','CursorObsidianMcpWatchdog' -ErrorAction SilentlyContinue |
  Disable-ScheduledTask
```

**Reactivar después:**

```powershell
Get-ScheduledTask -TaskName 'CursorMemoryAutoSync','CursorMemoryVaultSync','CursorObsidianMcpWatchdog' -ErrorAction SilentlyContinue |
  Enable-ScheduledTask
```

Ajusta los nombres a los que tengas en `taskschd.msc`.

## 2. Cursor y el vault

- Con el vault abierto como carpeta, usa **`.vscode/settings.json`** (plantilla en `examples/.vscode/` o lo que escriba `create-obsidian-memory`) para **Git sin autorefresh** agresivo.
- **MCP:** cuantos menos servidores activos, menos procesos en segundo plano.
- **Juego serio:** cierra Cursor o no abras el vault en esa sesión.

## 3. Robo de foco (fullscreen)

- Las tareas **bien** montadas con `wscript` + `Run-Hidden.vbs` **no deberían** mostrar ventana.
- Si aún ves **conhost**/consola al jugar, suele ser **otra app** (launcher, overlay, antivirus) o **Git del propio juego/launcher** — vuelve a pasar el monitor  
  `tools/monitor-console-live.ps1` **mientras** reproduce el fallo y mira **padre + CommandLine**.

## 4. Red y disco

- Sync git con muchos cambios puede **picar disco** unos segundos; con intervalos largos o solo al salir del juego reduces tirones.

## Resumen

| Situación                                   | Qué hacer                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Quiero memoria al día sin molestar al jugar | Intervalos de tarea **largos** o **Disable** antes de jugar y **Enable** después.      |
| Menos lag con Cursor abierto                | `.vscode` del vault + **menos MCP/extensiones**; idealmente **sin** Cursor en partida. |
| Sin flashes CMD                             | Tareas con **wscript**; IDE con ajustes Git calmados; ver script de auditoría arriba.  |

Más contexto: [`windows-sin-consola-visible.md`](./windows-sin-consola-visible.md).
