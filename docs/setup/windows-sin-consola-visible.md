# Windows: evitar ventanas de consola (CMD) con Cursor

Objetivo: **no depender de reiniciar Cursor** para tener un escritorio limpio. Las causas suelen ser tres: **IDE (Git / extensiones)**, **MCP (`node`, `uvx`, `npx`)**, y **Tareas programadas** que llaman a `powershell.exe` o `cmd.exe` directamente.

## 1. Abrir siempre la carpeta correcta (workspace)

Los ajustes del repo están en **`.vscode/settings.json`**. Solo aplican si abres el **directorio raíz** del repo o del vault (**File → Open Folder**), no un archivo suelto.

Después de actualizar el repo: **Developer: Reload Window** una vez.

## 2. Ajustes del workspace (ya incluidos en este kit)

En la raíz (y en el vault vía `create-obsidian-memory` o `examples/.vscode/`) se desactiva el sondeo agresivo de Git y parte de la decoración SCM, y se excluyen rutas ruidosas del watcher (incluye `.obsidian/` y cachés de build).

Si necesitas el panel Git en tiempo real en **esta** carpeta, edita **tu copia** de `.vscode/settings.json` y vuelve a poner `git.autorefresh` en `true` (acepta más procesos `git`/`conhost`).

## 3. Tareas programadas `Cursor*`

Si una tarea ejecuta **`powershell.exe` / `cmd.exe` a pelo**, Windows puede mostrar un flash aunque el intervalo sea largo.

1. Revisa con el script del repo (desde la raíz del clon):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Get-CursorScheduledTaskConsoleRisk.ps1
   ```

2. Reconstruye acciones con **`wscript.exe //nologo ...\Run-Hidden.vbs ...\TuScript.ps1`** como en [`windows-basic-memory-always-on.md`](./windows-basic-memory-always-on.md) y [`windows-scheduled-vault-sync.md`](./windows-scheduled-vault-sync.md).

## 4. MCP y extensiones

- Cada servidor MCP con **`command`** (`uvx`, `node`, `npx`) puede levantar **consola** en Windows; no lo controla este repo por completo. Reduce MCP activos en **Settings → MCP** y desactiva extensiones que ejecuten Git o shells en bucle (p. ej. prueba sin GitLens).
- Diagnóstico: [`tools/monitor-console-live.ps1`](../../tools/monitor-console-live.ps1) (padre + `CommandLine`).

## 5. Límite honesto

**No existe** un interruptor en Markdown que garantice cero ventanas en **todas** las combinaciones de extensiones, MCP y tareas del sistema. Este kit aplica **workspace + tareas sin consola + guía** para acercarse a “cero flashes” en el uso normal del vault y del repo.
