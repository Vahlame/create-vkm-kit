# @vkmikc/obsidian-prompt-compiler

Compila una idea de una línea + contexto del vault en un prompt XML (`<orchestration_package>`)
y lo copia al portapapeles, listo para pegar en una herramienta de IA que **no** tiene el
MCP del vault conectado (un chat web, otro editor sin wiring). Si tu destino SÍ tiene
`vault_hybrid_search` disponible (Claude Code/Codex/Cursor con este kit instalado), no
necesitás esta herramienta — el agente ya puede buscar por su cuenta, on-demand y más
barato. Ver [ADR-0029](../../docs/adr/0029-disable-claude-native-auto-memory.md) y
[ADR-0018](../../docs/adr/0018-multi-agent-token-efficiency.md) para el porqué.

**Sin LLM externo.** El contexto sale de `vault_observations` (hechos tipados
`[decision]`/`[gotcha]`/`[fact]`, ya destilados) y `vault_hybrid_search` (BM25 +
semántico), vía el mismo bridge Python que usa el MCP híbrido — cero API keys nuevas,
cero costo por invocación.

## Uso

```bash
obsidian-prompt "agregar autenticación JWT al backend" --project app-ap-sport-inv
```

Sin `--project`, te lo pregunta interactivo (autocomplete sobre `PROJECTS/*.md`). Si no
hay info previa para el proyecto, te pregunta si querés agregar contexto en tus palabras
antes de compilar. Antes de copiar, si tenés `$EDITOR`/`$VISUAL` seteado, te ofrece
abrirlo para revisar/corregir — el prompt compilado es un punto de partida, no algo para
pegar a ciegas.

### Opciones

```
--project <name>        Proyecto (PROJECTS/<name>.md). Sin esto, selector interactivo.
--vault <path>          Default: BASIC_MEMORY_HOME / OBSIDIAN_MEMORY_VAULT.
--lang es|en             Idioma del prompt compilado (default: es).
--files <a,b,c>          Rutas para <active_files>.
--requirements <a,b,c>   Requisitos funcionales (numerados en la salida).
--constraints <a,b,c>    Restricciones (bajo <guardrails>).
--format <text>          Pista de formato de salida esperado (<format>).
--no-editor              No ofrecer abrir $EDITOR antes de copiar.
--no-clipboard           Imprime el XML en vez de copiarlo (útil para pipes/CI).
-y, --yes                Sin prompts de confirmación (no interactivo).
```

## GUI (opcional — un ícono de escritorio, sin CLI)

Mismo core, otra cáscara: un server HTTP local (`node:http`, sin Express) + una página
con JS vanilla (sin React/Vue, sin build step) — la opción más liviana y rápida que
encontrar app nativa, justo por eso elegida en vez de Tauri/Electron.

```bash
# una vez: deja un acceso directo en el Escritorio (Windows; sin ventana de consola)
node src/server.mjs --install-shortcut --vault "<ruta-al-vault>"

# o arrancarlo directo (abre el navegador solo)
npm run gui -- --vault "<ruta-al-vault>"
```

Doble-click en el ícono → arranca el server → abre tu navegador en `localhost` → escribís
el proyecto (autocomplete) y la idea → el XML se arma **en vivo** mientras tipeás (debounce
400ms, mismo `context-search.mjs`/`compile-xml.mjs` que el CLI) → un click copia al
portapapeles (`navigator.clipboard`, del lado del browser, no del server) con confirmación
visual clara. Si ya hay una instancia corriendo (doble-click sin querer dos veces), el
servidor nuevo detecta el puerto ocupado y simplemente reabre el navegador ahí, en vez de
fallar. Solo escucha en `127.0.0.1` — nunca expuesto a la red.

## Esquema XML

Reducido del catálogo genérico de ~35 etiquetas a las hojas que importan para este caso
(tarea de código + contexto de proyecto): `system_role`, `project_environment`
(`tech_stack`/`active_files`/`current_state`), `knowledge_base_context`
(`historical_decisions`/`active_patterns`), `execution_spec`
(`user_intent`/`functional_requirements`), `guardrails`
(`constraints`/`forbidden`/`must_include`, solo los que tengan contenido), `format`/
`example`/`note` (opcionales, se omiten si no aplican), `output_format_instructions`.
Se descartaron a propósito `<thinking>`/`<reflect>`/`<self_critique>`/`<check>`/`<verify>`
— no cambian el comportamiento de forma confiable y, si el destino es Claude con el MCP
conectado, duplican doctrina que ya está en su CLAUDE.md.

Todo el texto va envuelto en `CDATA` (no entity-escaping) para que pasajes del vault o
fragmentos de código con `<`/`>`/`&` queden legibles en vez de convertirse en `&lt;` soup
— la salida está pensada para leerse y pegarse, no para que un parser XML la procese.

## Módulos

- `src/project-resolve.mjs` — capturador: resuelve `PROJECTS/<name>.md`, interactivo si hace falta.
- `src/context-search.mjs` — cliente: `vault_observations` + `vault_hybrid_search` vía
  `@vkmikc/obsidian-memory-mcp/src/rag-client.mjs` (mismo bridge Python que el MCP híbrido).
- `src/compile-xml.mjs` — compilador: arma el `<orchestration_package>`, puro, sin I/O.
- `src/clipboard.mjs` / `src/review.mjs` — copiador + paso de revisión en `$EDITOR` (CLI).
- `src/prompt-defaults.mjs` — copys compartidas (system role, nota de fallback) entre CLI y GUI.
- `src/cli.mjs` — orquesta todo lo anterior (modo terminal).
- `src/server.mjs` + `public/index.html` — orquesta lo mismo vía HTTP local (modo GUI).

## Limitaciones conocidas (v1)

- `active_files` es manual (`--files`), no se infiere del filesystem local todavía.
- `system_role` es una plantilla fija con el nombre del proyecto, no algo generado.
- Requiere Python 3.11+ con `obsidian-memory-rag` (mismo requisito que el MCP híbrido).
- Búsqueda acotada al proyecto (nombre calificado + `--graph`) reduce bastante el ruido
  cross-proyecto contra un vault real grande, pero no lo elimina del todo — notas "hub"
  (`SESSION_LOG.md`, `PRACTICES/lessons-learned.md`) enlazan a varios proyectos. Por eso
  la revisión antes de copiar (`$EDITOR` en CLI, lectura del preview en GUI) es necesaria,
  no decorativa.
- `--install-shortcut` solo soporta Windows (el truco de ventana oculta es un
  `WScript.Shell`-ismo); en macOS/Linux usar `npm run gui` directo por ahora.
