# Windows: evitar ventanas de consola (CMD) con Cursor

Objetivo: **menos flashes de consola** sin depender de scripts del kit. Las causas habituales son **IDE (Git / extensiones)**, **MCP (`node`, `uvx`, `npx`)**, y **tareas programadas** que ejecutan `powershell.exe` o `cmd.exe` directamente.

## 1. Abrir siempre la carpeta correcta (workspace)

Los ajustes del repo están en **`.vscode/settings.json`**. Solo aplican si abres el **directorio raíz** del repo o del vault (**File → Open Folder**), no un archivo suelto.

Después de actualizar el repo: **Developer: Reload Window** una vez.

## 2. Ajustes del workspace (ya incluidos en este kit)

En la raíz (y en el vault vía `create-obsidian-memory` o `examples/.vscode/`) se desactiva el sondeo agresivo de Git y parte de la decoración SCM, y se excluyen rutas ruidosas del watcher (incluye `.obsidian/` y cachés de build). También **`git.terminalAuthentication`: false** para no forzar consola en autenticación Git.

Si ves ventanas con título **`…\Git\bin\git.exe`** o **`bin\sh.exe`**, fuerza en **User** o **workspace** JSON: **`"git.path": "C:\\Program Files\\Git\\cmd\\git.exe"`** (el `cmd\git.exe`, no el de `bin\`). En Windows el inicializador del kit intenta escribir `git.path` al fusionar el vault si esa ruta existe.

Si necesitas el panel Git en tiempo real en **esta** carpeta, edita **tu copia** de `.vscode/settings.json` y vuelve a poner `git.autorefresh` en `true` (acepta más procesos `git`/`conhost`).

## 3. Tareas programadas `Cursor*` (si las creaste tú)

Abre **Programador de tareas** (`taskschd.msc`) → biblioteca → tareas cuyo nombre empiece por `Cursor` → pestaña **Acciones**. Si el programa es **`powershell.exe`** o **`cmd.exe`** sin ventana minimizada, Windows puede mostrar un flash al dispararse. Ajusta la acción (otro programa, o “Iniciar minimizado” si tu caso lo permite) o desactiva la tarea cuando no la necesites.

Este repo **no** publica plantillas VBS/PowerShell para ocultar consola.

## 4. MCP y extensiones

- Cada servidor MCP con **`command`** (`uvx`, `node`, `npx`) puede levantar **consola** en Windows; no lo controla este repo por completo. Reduce MCP activos en **Settings → MCP** y desactiva extensiones que ejecuten Git o shells en bucle (p. ej. prueba sin GitLens).
- Diagnóstico: **Administrador de tareas** → **Detalles** (columna línea de comando) o **Monitor de recursos** mientras reproduce el problema.

## 5. Límite honesto

**No existe** un interruptor en Markdown que garantice cero ventanas en **todas** las combinaciones de extensiones, MCP y tareas del sistema. Este kit aplica **workspace + guías** para acercarse a “cero flashes” en el uso normal del vault y del repo.

**Juego a pantalla completa + sync del vault:** [`windows-juego-vault-sync.md`](./windows-juego-vault-sync.md).
