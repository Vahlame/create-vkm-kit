# Instalar memoria Markdown en Cursor — Kit v3

> **Cómo usar este archivo:** Pégalo en un chat nuevo de Cursor. El agente leerá las instrucciones y ejecutará cada paso para dejar la memoria configurada y verificada en esta máquina.

---

Eres un agente de Cursor. Tu tarea es configurar el **sistema de memoria Markdown v3** en esta máquina. Sigue los pasos en orden, ejecutando comandos cuando sea necesario, y reporta el resultado de cada uno antes de pasar al siguiente.

El kit de referencia está en este repositorio. Si no sabes la ruta del clon, pregúntala al usuario antes de empezar o usa el directorio de trabajo actual.

---

## Paso 0 — Verificar prerrequisitos

Comprueba que estos programas están instalados y accesibles:

```powershell
node --version          # Debe ser v20 o superior
uvx --version           # Debe responder (no "no reconocido")
git --version           # Para el vault git
```

- Si **Node** no está: <https://nodejs.org/en/download> (LTS). En Windows: `winget install OpenJS.NodeJS.LTS`
- Si **uv/uvx** no está: <https://docs.astral.sh/uv/getting-started/installation/> (Windows: `winget install astral-sh.uv`)
- Después de instalar, **cierra y vuelve a abrir el terminal** para refrescar el PATH.

Informa al usuario cuál de las herramientas falta, si alguna, y espera a que la instale antes de continuar.

---

## Paso 1 — Elegir la ruta del vault

Pregunta al usuario dónde quiere guardar el vault (carpeta de notas Markdown).

Sugerencia por defecto: `%USERPROFILE%\Documents\cursor-memory-vault` (Windows) / `~/Documents/cursor-memory-vault` (Linux/macOS).

El vault puede ser una carpeta nueva o una existente. Anota la ruta elegida; la llamaremos `<VAULT_PATH>`.

---

## Paso 2 — Inicializar vault y configurar MCP

Ejecuta el inicializador desde **el clon de este kit** (ajusta `<KIT_ROOT>` a la ruta real del repo):

```bash
node "<KIT_ROOT>/packages/create-obsidian-memory/dist/index.js" \
  --non-interactive \
  --vault "<VAULT_PATH>"
```

En Windows (PowerShell), el separador de líneas es con `` ` ``:

```powershell
node "<KIT_ROOT>\packages\create-obsidian-memory\dist\index.js" `
  --non-interactive `
  --vault "<VAULT_PATH>"
```

**Qué hace este comando:**

- Crea el vault si no existe, con la estructura `START_HERE.md`, `MEMORY.md`, `SESSION_LOG.md`, `PROJECTS/`, `RULES/`, `KNOWN_FAILURES.md`, `TAGS.md`.
- Añade `.vscode/settings.json` al vault (reduce ruido Git en Windows).
- Fusiona la entrada `basic-memory` en `%USERPROFILE%\.cursor\mcp.json` (Windows) o `~/.cursor/mcp.json` (Linux/macOS) **sin borrar** otras entradas que ya existieran.
- Hace un backup automático de `mcp.json` como `mcp.json.bak`.

Si el clon del kit no está disponible y prefieres usar npm directamente:

```bash
npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "<VAULT_PATH>"
```

Muestra la salida del comando al usuario y confirma que no hubo errores. Si dice `mcp.json updated` o `merged`, continúa.

---

## Paso 3 — Verificar mcp.json

Muestra al usuario el contenido actual de su `mcp.json` (ruta según SO):

| Sistema | Ruta de `mcp.json`                                                            |
| ------- | ----------------------------------------------------------------------------- |
| Windows | `%USERPROFILE%\.cursor\mcp.json`                                              |
| Linux   | `~/.config/Cursor/User/globalStorage/cursor.mcp/mcp.json`                     |
| macOS   | `~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/mcp.json` |

Confirma que la entrada `basic-memory` existe y que `BASIC_MEMORY_HOME` apunta a `<VAULT_PATH>`. Ejemplo esperado:

```json
{
  "mcpServers": {
    "basic-memory": {
      "command": "uvx",
      "args": ["basic-memory", "mcp"],
      "env": {
        "BASIC_MEMORY_HOME": "<VAULT_PATH>"
      }
    }
  }
}
```

Si la ruta en `BASIC_MEMORY_HOME` es incorrecta, corrígela directamente en el archivo.

---

## Paso 4 — Pegar User Rules en Cursor

Indica al usuario que abra **Cursor → Settings → Rules → User Rules** y pegue el siguiente bloque completo (reemplazando el contenido previo si ya tenía reglas de versiones anteriores):

```text
## Memoria Markdown (vault + MCP v3)

**Motivo:** el modelo no persiste entre chats; el vault en git es auditable, portable y tuyo.

### No confundir con la memoria integrada de Cursor
- Los recursos `memory://...` (toasts o enlaces) son **memoria nativa del IDE**, no archivos del vault.
- Esta memoria vive en **Markdown en disco** mediante las herramientas MCP del vault.

### MCP disponible
- **`basic-memory`** (siempre): `read_note`, `write_note`, `edit_note`, `search_notes`, `build_context`, `recent_activity`. Rutas relativas a `BASIC_MEMORY_HOME`.
- **`obsidian-memory-hybrid`** (si aparece en verde): `vault_fts_search` para búsqueda BM25/FTS5 rápida; `vault_fts_index` tras importaciones masivas. Si no está activo, usa `search_notes` de `basic-memory`.
- Si **ningún** servidor MCP del vault responde, dilo explícitamente; no afirmes haber persistido.

### Arranque (al inicio de cualquier tarea)
1. `read_note("START_HERE.md")` — orden de lectura del vault.
2. `read_note("MEMORY.md")` — preferencias globales y lecciones duraderas.
3. `read_note("PROJECTS/<proyecto>.md")` donde `<proyecto>` coincide con el nombre corto del repo o carpeta activa. Si no existe, créalo con `write_note`.

### On-demand (solo si aplica)
- Reglas duras del proyecto: `RULES/<proyecto>.md`
- Historial de sprint: `PROJECTS/<proyecto>/SPRINTS.md`
- Runbook: `PROJECTS/<proyecto>/RUNBOOK.md`
- Patrones de fallo: `KNOWN_FAILURES.md`
- Índice de etiquetas: `TAGS.md`

### Durante la tarea
- Registrar decisiones relevantes en `PROJECTS/<proyecto>.md`.
- No guardar secretos, tokens, JWTs ni IDs de hardware literales.
- Checkpoint en `SESSION_LOG.md` solo con avance real (cada varios mensajes o al cerrar).

### Al cerrar la tarea
- Entrada breve en `SESSION_LOG.md` (fecha ISO, proyecto, resultado o decisión).
- Lecciones transversales en `MEMORY.md`.
- Regla dura nueva en `RULES/<proyecto>.md` si aplica.
- Camino descartado en `KNOWN_FAILURES.md` con motivo.

### Estilo de notas
- Cortas y accionables. Separar **hechos** e **hipótesis** explícitamente.
- Usar wikilinks `[[...]]` para navegar entre notas.
- No rellenar el vault de ruido: una línea por decisión, no párrafos.
```

Pide al usuario que guarde y que **reinicie Cursor** (o haga `Developer: Reload Window`).

---

## Paso 5 — Verificar que MCP funciona

Después de que el usuario reinicie Cursor, abre un chat nuevo e intenta leer el vault:

```text
read_note("START_HERE.md")
```

Si la herramienta responde con contenido del archivo, la instalación es correcta. Confirma al usuario:

✓ `basic-memory` conectado — el vault está en `<VAULT_PATH>`
✓ Las herramientas MCP responden (`read_note`, `write_note`, etc.)
✓ Las User Rules están activas (el agente sabe cómo usar el vault)

Si falla, consulta [`docs/troubleshooting.md`](./docs/troubleshooting.md) sección "MCP / Cursor errors".

---

## Paso 6 (Opcional) — Sincronización automática con git

Si el usuario quiere que el vault se sincronice automáticamente con GitHub:

1. Asegúrate de que hay un repositorio git en `<VAULT_PATH>` (`git init` si no existe).
2. Crea un repo privado en GitHub (`gh repo create memory-agents --private --source <VAULT_PATH> --push`).
3. Para sincronización automática sin ventanas emergentes en Windows, compila el daemon:

   ```powershell
   # Desde la raíz del kit
   go build -ldflags="-H windowsgui" -o bin\obsidian-memoryd.exe .\cmd\obsidian-memoryd
   ```

4. Crea un acceso directo en `shell:startup` que apunte a `obsidian-memoryd.exe watch --vault "<VAULT_PATH>"`.

Guía completa: [`docs/setup/windows-scheduled-vault-sync.md`](./docs/setup/windows-scheduled-vault-sync.md).

---

## Paso 7 (Opcional) — Búsqueda avanzada en vaults grandes (híbrido FTS)

Si el vault tiene cientos de notas y se quiere búsqueda BM25 rápida:

```bash
# 1. Instalar el backend Python (solo una vez)
pip install -e "<KIT_ROOT>/packages/obsidian-memory-rag"

# 2. Añadir obsidian-memory-hybrid a mcp.json
node "<KIT_ROOT>/packages/create-obsidian-memory/dist/index.js" \
  --non-interactive --vault "<VAULT_PATH>" \
  --with-hybrid --repo-root "<KIT_ROOT>"
```

Reinicia Cursor. Luego usa `vault_fts_index` para construir el índice y `vault_fts_search` para buscar.

---

## Resumen final

Al terminar, confirma al usuario el estado:

| Componente                   | Estado                |
| ---------------------------- | --------------------- |
| Vault creado                 | `<VAULT_PATH>`        |
| `basic-memory` en `mcp.json` | ✓                     |
| User Rules pegadas           | ✓                     |
| MCP verificado               | ✓ (o ✗ + instrucción) |
| Git sync                     | Opcional              |
| Híbrido FTS                  | Opcional              |

**Siguiente chat:** el agente leerá `START_HERE.md` → `MEMORY.md` → `PROJECTS/<proyecto>.md` al inicio de cada tarea.
