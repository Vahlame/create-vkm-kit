# Cursor + memoria Markdown (v2): MCP, vault y User Rules

**Flujo del repo:** si empiezas de cero, sigue primero [`../GETTING_STARTED.md`](../GETTING_STARTED.md) y [`how-memory-works-simple.md`](./how-memory-works-simple.md); este archivo es el **detalle Cursor** (MCP + User Rules + verificación).

Esta guía une lo que antes estaba repartido entre README, `AGENTS.md`, migración v1→v2 y el prompt legacy. **Objetivo:** que sepas _qué_ configurar, _dónde_, y _por qué_.

## Flujo recomendado (vista rápida)

| Orden | Qué haces                                                      | Dónde                                                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Tabla de pasos sin saltos                                      | [`GETTING_STARTED.md`](../GETTING_STARTED.md)                                                                                                                                                                                                                |
| 2     | Modelo mental vault / MCP / User Rules                         | [`how-memory-works-simple.md`](./how-memory-works-simple.md)                                                                                                                                                                                                 |
| 3     | Fusionar `mcp.json` con tu vault (rápido) o editar a mano      | [Paso 4](#paso-4-inicializar-o-fusionar-config-sin-prompts) y [`../config/mcp/`](../config/mcp/)                                                                                                                                                             |
| 4     | MCP + comprobar tools + **User Rules**                         | [Pasos 1 a 3](#paso-1-configurar-mcp-en-cursor) de esta guía                                                                                                                                                                                                 |
| 5     | Inspector y checks                                             | [`testing/manual-checks.md`](./testing/manual-checks.md)                                                                                                                                                                                                     |
| 6     | (Solo Windows) Autosync git, MCP HTTP siempre encendido, smoke | [`setup/windows-scheduled-vault-sync.md`](./setup/windows-scheduled-vault-sync.md), [`setup/windows-basic-memory-always-on.md`](./setup/windows-basic-memory-always-on.md), [`testing/windows-memory-sync-smoke.md`](./testing/windows-memory-sync-smoke.md) |

## Las tres capas (y por qué no basta una)

| Capa              | Qué es                                                                                                                     | Por qué importa                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Vault**         | Carpeta con Markdown (y git): `START_HERE.md`, `MEMORY.md`, `PROJECTS/`, etc.                                              | Es **tu** memoria: la editas fuera del IDE, la versionas, la respaldas.                                                     |
| **MCP en Cursor** | Entradas en `%USERPROFILE%\.cursor\mcp.json` que arrancan procesos (`uvx basic-memory mcp`, opcionalmente el híbrido FTS). | Sin MCP, el agente **no puede** leer ni escribir el vault por herramientas.                                                 |
| **User Rules**    | Texto en `Cursor → Settings → Rules → User Rules`.                                                                         | Le dice al modelo **cuándo** abrir qué nota y **cómo** cerrar sesiones. No sustituye al MCP: solo guía el uso de las tools. |

Si falta el vault, no hay datos. Si falta el MCP, no hay tools. Si faltan User Rules, el modelo puede ignorar el flujo de lectura o no registrar en `SESSION_LOG.md`.

## Requisitos en tu PC

### Node 20+

Necesario para Cursor y, si usas híbrido, para `node …/hybrid-mcp.mjs`.

### uv

Para `uvx basic-memory mcp`. Windows, instalación oficial:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
```

Cierra y abre Cursor (o la terminal) para que `uvx` esté en el `PATH` del usuario (`%USERPROFILE%\.local\bin`).

### Ruta del vault

Ejemplo histórico: `%USERPROFILE%\Documents\cursor-memory-vault`. Debe ser la **misma** ruta que pongas en `BASIC_MEMORY_HOME` en `mcp.json`.

### (Opcional híbrido) Python 3.11+ y paquete RAG

Instalación típica desde el clon de este repo:

```powershell
python -m pip install -e "C:\ruta\al\repo\packages\obsidian-memory-rag"
```

El híbrido ejecuta `python -m obsidian_memory_rag …`; si el módulo no resuelve, revisa `docs/troubleshooting.md` y `docs/testing/manual-checks.md` §7.

## Paso 1: Configurar MCP en Cursor

**Archivo:** `%USERPROFILE%\.cursor\mcp.json` (Windows). Otros SO: documentación de Cursor para la ruta equivalente.

### Cómo conecta Cursor a `basic-memory`: stdio vs URL

- **stdio (recomendado por defecto):** en `mcp.json` usas `command` + `args` (`uvx basic-memory mcp`) y `env.BASIC_MEMORY_HOME`. Cursor **arranca** el proceso cuando hace falta; no necesitas un puerto local.
- **URL / Streamable HTTP (opcional, sobre todo Windows “siempre encendido”):** la entrada solo tiene `"url": "http://127.0.0.1:8765/mcp"` (plantilla `config/mcp/basic-memory-streamable-http.json`). Entonces **tiene que haber** un proceso escuchando en ese puerto **antes** de que Cursor conecte (tarea `CursorBasicMemoryHttpMcp` o script equivalente). Si falta, en el log MCP aparecen errores tipo `fetch failed` / `streamableHttp`; ver [`docs/troubleshooting.md`](./troubleshooting.md) y [`docs/setup/windows-basic-memory-always-on.md`](./setup/windows-basic-memory-always-on.md).

### Solo `basic-memory` por stdio (recomendado mínimo)

Copia la plantilla `config/mcp/basic-memory.json` y sustituye `<VAULT_PATH>` por la ruta **absoluta** al vault (en JSON Windows usa `\\` o `/`).

**Qué hace `BASIC_MEMORY_HOME`:** le dice a `basic-memory` cuál es la raíz del vault; todas las rutas de las tools son **relativas a esa raíz**.

### Añadir híbrido FTS (opcional)

Si quieres `vault_fts_search` / `vault_fts_index` en el IDE, fusiona `config/mcp/obsidian-memory-hybrid.json`: sustituye `<REPO_ROOT>` por el clon **absoluto** de este repo y `<VAULT_PATH>` por tu vault (o confía en `BASIC_MEMORY_HOME` si ya lo defines en esa entrada).

**Por qué dos servidores:** `basic-memory` cubre lectura/escritura y búsqueda integrada. El híbrido añade un índice **SQLite FTS5 (BM25)** en disco; compensa vaults muy grandes donde `search_notes` no te basta.

## Paso 2: Comprobar que Cursor ve las tools

1. Abre **Cursor → Settings → MCP** y verifica que `basic-memory` está en verde (o revisa el log de errores si está en rojo).
2. Prueba con Inspector (ver `docs/testing/manual-checks.md` §2): deben existir al menos `read_note`, `write_note`, `edit_note`, `search_notes`, `build_context`, `recent_activity`.

Si `uvx` falla, casi siempre es **uv no instalado** o **PATH sin reiniciar**; ver `docs/troubleshooting.md`.

## Paso 3: User Rules (pegar en Cursor)

En **Cursor → Settings → Rules → User Rules**, pega el bloque siguiente. **Importante:** los nombres `basic-memory` y `obsidian-memory-hybrid` deben coincidir con las claves bajo `mcpServers` en tu `mcp.json`. Si renombraste un servidor, cambia el texto de las reglas para que coincida.

```markdown
## Memoria Markdown (vault + MCP v2)

**Motivo:** el modelo no persiste entre chats; el vault en git es auditable, portable y tuyo.

### No confundir con la memoria integrada de Cursor

- Los recursos **`memory://...`** (toasts o enlaces) son **memoria nativa / virtual del IDE**, no archivos de tu vault.
- Esta memoria vive en **Markdown en disco** y solo mediante las **herramientas MCP** del vault (`read_note`, `write_note`, …). Para abrir o cambiar una nota del vault, usa esas tools; no asumas rutas `memory://` para el vault.

### Cómo está conectado `basic-memory` (stdio vs URL)

- Si `mcp.json` usa **`command` + `uvx`** hacia `basic-memory`, es **stdio**: Cursor arranca el servidor; no hace falta un puerto HTTP fijo.
- Si la entrada **`basic-memory` solo tiene `"url"`** (p. ej. `http://127.0.0.1:8765/mcp` o **otro puerto** si lo cambiaste por conflicto), hace falta un **servidor HTTP ya levantado** (p. ej. tarea `CursorBasicMemoryHttpMcp` en Windows). Sin proceso en ese puerto verás fallos tipo `fetch failed` en el log MCP.
- Banners ASCII o líneas con `undefined` en stderr del servidor suelen ser **ruido de arranque**; lo importante es que el panel MCP liste tools y quede operativo.

### MCP disponible

- Si el servidor **`basic-memory`** está activo, úsalo para el vault: `read_note`, `write_note`, `edit_note`, `search_notes`, `build_context`, `recent_activity`. Las rutas son relativas a la raíz del vault (`BASIC_MEMORY_HOME`).
- Si además está **`obsidian-memory-hybrid`**, para búsqueda léxica BM25/FTS5 usa `vault_fts_search`; tras importaciones masivas o primera indexación en vault grande, `vault_fts_index`. Si no está el híbrido, basta `search_notes` de `basic-memory`.
- Si **no** hay MCP del vault disponible, dilo explícitamente; no afirmes haber persistido en el vault.

### Arranque (tareas que toquen contexto del vault)

1. Leer con `read_note` el archivo de entrada del vault (p. ej. `START_HERE.md`).
2. Leer `MEMORY.md`.
3. Usar o crear `PROJECTS/<proyecto>.md` alineado al nombre de carpeta o repo actual; leerlo si existe (`<proyecto>` = identificador corto, sin espacios raros).

### On-demand (solo si aplica)

- Reglas duras: `RULES/<proyecto>.md`.
- Historial de sprint: `PROJECTS/<proyecto>/SPRINTS.md`.
- Runbook: `PROJECTS/<proyecto>/RUNBOOK.md`.
- Patrones de fallo: `KNOWN_FAILURES.md`.
- Índice de tags: `TAGS.md`.

### Durante la tarea

- Registrar decisiones relevantes en `PROJECTS/<proyecto>.md` o en `SPRINTS.md` si es cierre de sprint.
- No guardar secretos, tokens, JWTs ni IDs de hardware literales.
- No llenar el vault de ruido: checkpoint en `SESSION_LOG.md` solo con avance real (cada varios mensajes o al cerrar).

### Al cerrar la tarea

- Añadir una entrada breve en `SESSION_LOG.md` (fecha, proyecto, resultado o decisión).
- Lecciones transversales en `MEMORY.md`.
- Nueva regla dura del proyecto en `RULES/<proyecto>.md`.
- Camino descartado en `KNOWN_FAILURES.md` con el motivo.

### Estilo

- Notas cortas y accionables; separar **hechos** e **hipótesis** con palabras explícitas.
- Usar wikilinks `[[...]]` cuando ayuden a navegar el vault.
```

### Versión en inglés

Misma estructura en [`cursor-memory-setup.en.md`](./cursor-memory-setup.en.md) (bloque listo para pegar en inglés).

## Paso 4: Inicializar o fusionar config sin prompts

Desde la raíz de un clon de este repo (o con `npx @vahlame/create-obsidian-memory@next`):

```bash
npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "C:\RUTA\ABSOLUTA\AL\VAULT"
```

Eso **mezcla** la entrada `basic-memory` en `mcp.json` sin borrar otras claves (y tolera `mcp.json` con BOM UTF-8). Ver `CHANGELOG.md` y `docs/troubleshooting.md`.

## Dónde seguir leyendo

| Tema                                                                | Documento                             |
| ------------------------------------------------------------------- | ------------------------------------- |
| Checklist manual (Inspector, FTS, híbrido)                          | `docs/testing/manual-checks.md`       |
| Errores frecuentes (uv, BOM, MCP rojo, `fetch failed`, `memory://`) | `docs/troubleshooting.md`             |
| Protocolo genérico para cualquier IDE                               | `AGENTS.md` (sección Memory protocol) |
| Layout de ejemplo en el repo                                        | `examples/`                           |

## Resumen en una frase

Configura **MCP** (`mcp.json` + `uv`) para que existan las tools, mantén el **vault** en git, y usa **User Rules** para obligar al agente a leer `START_HERE` → `MEMORY` → `PROJECTS` y a cerrar en `SESSION_LOG`.
