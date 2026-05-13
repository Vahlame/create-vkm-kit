# Windows: vault en git sin tirones ni ventanas durante el juego

Objetivo: **actualizar la memoria** (pull/push del vault) cuando quieras, pero que **no** haya picos de disco/Git ni **CMD/consolas** que quiten foco del juego a pantalla completa.

## Principio

Separar **“cuándo sincronizo”** de **“cuándo juego”**:

1. **Menos automatismo en segundo plano** — preferir [`obsidian-memoryd watch`](../../cmd/obsidian-memoryd) o **git manual**; ver [`windows-scheduled-vault-sync.md`](./windows-scheduled-vault-sync.md).
2. **Menos sondeo del IDE** (solo cuando trabajas en el vault con Cursor abierto): `.vscode/settings.json` del vault.
3. Si usaste **Programador de tareas**, revisa en `taskschd.msc` que las acciones no lancen consolas innecesarias; este kit **no** publica plantillas de script para copiar.

Cursor + vault abierto en la misma sesión que un juego competitivo **sigue siendo pesado** (Git, extensiones, MCP). Lo más limpio: **cerrar Cursor** al jugar, o no abrir la carpeta del vault hasta terminar.

## 1. Programador de tareas (si lo usas)

- Sube el intervalo o desactiva tareas que no necesites durante la partida.
- Evita **dos** automatismos distintos que hagan `git` al mismo ritmo (redundancia = más I/O).

**Pausar tareas antes de jugar** (ajusta los nombres a los que tengas):

```powershell
Get-ScheduledTask -TaskName 'CursorMemoryVaultSync','CursorBasicMemoryHttpMcp' -ErrorAction SilentlyContinue |
  Disable-ScheduledTask
```

**Reactivar después:**

```powershell
Get-ScheduledTask -TaskName 'CursorMemoryVaultSync','CursorBasicMemoryHttpMcp' -ErrorAction SilentlyContinue |
  Enable-ScheduledTask
```

## 2. Cursor y el vault

- Con el vault abierto como carpeta, usa **`.vscode/settings.json`** (plantilla en `examples/.vscode/` o lo que escriba `create-obsidian-memory`) para **Git sin autorefresh** agresivo.
- **MCP:** cuantos menos servidores activos, menos procesos en segundo plano.
- **Juego serio:** cierra Cursor o no abras el vault en esa sesión.

## 3. Robo de foco (fullscreen)

- Si ves **conhost**/consola al jugar, suele ser **Cursor, extensiones, Git del IDE** u **otra app** (launcher, overlay, antivirus). Usa **Administrador de tareas** → **Detalles** (línea de comando) mientras reproduce el fallo.

## 4. Red y disco

- Sync git con muchos cambios puede **picar disco** unos segundos; con intervalos largos o solo al salir del juego reduces tirones.

## Resumen

| Situación                                   | Qué hacer                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Quiero memoria al día sin molestar al juego | Menos tareas / intervalos largos / **Disable** antes de jugar y **Enable** después.    |
| Menos lag con Cursor abierto                | `.vscode` del vault + **menos MCP/extensiones**; idealmente **sin** Cursor en partida. |
| Sin flashes CMD                             | IDE con ajustes Git calmados; revisar tareas propias en `taskschd.msc`.                |

Más contexto: [`windows-sin-consola-visible.md`](./windows-sin-consola-visible.md).
