> 🇪🇸 Español · [🇬🇧 English](../en/install-with-agent.md)

# Instalar con un agente (pégalo en el chat)

Este archivo es un **instalador para un agente**: lo pegas en un chat de Cursor (o Claude Code)
y el agente ejecuta todos los pasos por ti, reportando cada uno. Es la alternativa "manos libres"
a la [instalación manual](instalacion.md).

**¿Usas Claude Code?** El bloque de abajo apunta a **Cursor** (escribe `mcp.json`, que Claude
Code no lee). Para Claude Code, sigue mejor [`instalar-pc-nueva.md`](instalar-pc-nueva.md) **Camino A**
— su bloque de agente usa `--ide claude` para registrar los servidores vía `claude mcp add`.

> ## ⚠️ Antes de pegar esto — verifica el origen
>
> Este archivo **autoriza a un agente a actuar como instalador con tus permisos** (toca
> `~/.cursor/mcp.json`, instala paquetes, edita git). Trátalo como un `curl ... | sh`:
>
> 1. **Léelo desde tu propio clon local**, no de un enlace al azar (Discord, X, un PR sin revisar).
> 2. En la raíz del clon, corre `git remote get-url origin` y `git log -1 --format="%H %s"`:
>    `origin` debe ser `https://github.com/Vahlame/cursor-obsidian-memory-guide.git` (o tu fork
>    legítimo) y el commit debe coincidir con la última release de
>    <https://github.com/Vahlame/cursor-obsidian-memory-guide/releases/latest>.
> 3. Si algo no cuadra, **no pegues nada** y abre un issue.

---

**Copia desde aquí hacia abajo y pégalo en un chat nuevo del agente:**

---

Eres un agente de Cursor/Claude Code. Tu tarea es instalar y **verificar** el sistema de
**memoria Markdown** en esta máquina. Sigue los pasos en orden; ejecuta los comandos y **reporta
el resultado de cada uno** antes de continuar. Si no conoces la ruta del clon del kit, pregúntala
o usa el directorio de trabajo actual; la llamaremos `<KIT_ROOT>`.

## Paso 0 — Prerrequisitos

Comprueba que existen Node 20+, uvx y git:

```bash
node --version
uvx --version
git --version
```

Si falta alguno, indícale al usuario cómo instalarlo (Windows: `winget install OpenJS.NodeJS.LTS`,
`winget install astral-sh.uv`) y **espera** a que reabra la terminal antes de seguir. No continúes
con herramientas faltantes.

## Paso 1 — Ruta del vault

Pregunta al usuario dónde quiere el vault. Por defecto:
`%USERPROFILE%\Documents\cursor-memory-vault` (Windows) / `~/Documents/cursor-memory-vault`
(Linux/macOS). Anótala como `<VAULT>`.

## Paso 2 — Crear el vault y conectar el MCP

Ejecuta el instalador desde el clon del kit:

```bash
node "<KIT_ROOT>/packages/create-obsidian-memory/src/index.js" --non-interactive --vault "<VAULT>"
```

En PowerShell (Windows), el salto de línea es con `` ` ``:

```powershell
node "<KIT_ROOT>\packages\create-obsidian-memory\src\index.js" `
  --non-interactive `
  --vault "<VAULT>"
```

Si no hay clon disponible, usa npm: `npx @vahlame/create-obsidian-memory -- --non-interactive --vault "<VAULT>"`.

**Qué hace:** crea el vault si no existe (`START_HERE.md`, `MEMORY.md`, `SESSION_LOG.md`,
`PROJECTS/`), fusiona `basic-memory` en `mcp.json` **sin borrar** otras entradas, hace backup
`mcp.json.bak.<fecha>`, y escribe `<VAULT>/.vscode/settings.json`. Muestra la salida y confirma
que no hubo errores.

## Paso 3 — Verificar `mcp.json`

Muestra al usuario la entrada `basic-memory` de su `mcp.json` (Windows: `%USERPROFILE%\.cursor\mcp.json`).
Confirma que `BASIC_MEMORY_HOME` apunta a `<VAULT>` y que los args incluyen el pin
`--from "basic-memory==0.21.4"` (seguridad supply-chain). Si la ruta está mal, corrígela.

## Paso 4 — User Rules

Abre [`docs/es/instalacion.md`](instalacion.md) en `<KIT_ROOT>`, copia **el bloque completo de
User Rules del Paso 4** y muéstraselo al usuario para que lo pegue en
**Cursor → Settings → Rules → User Rules** (es la fuente única; no lo reescribas de memoria).
Pídele que guarde y haga **Developer: Reload Window**.

## Paso 5 — Probar de extremo a extremo

Tras el reinicio, en un chat nuevo intenta leer una nota del vault (p. ej. `read_note("START_HERE.md")`).
Si responde con el contenido, la instalación es correcta. Confirma al usuario:

- ✅ `basic-memory` conectado (vault en `<VAULT>`)
- ✅ Las tools MCP responden
- ✅ User Rules activas

Si falla, consulta [`docs/es/troubleshooting.md`](troubleshooting.md) → sección **MCP / Cursor**.

## Paso 6 (opcional) — Sincronización git

Si el usuario quiere copia de seguridad / multi-máquina, ofréceselo y sigue
[`docs/es/sincronizacion.md`](sincronizacion.md) (daemon `obsidian-memoryd`, git manual, o mismo
repo). Para Windows sin ventanas: compila con `go build -ldflags="-H windowsgui" -o bin/obsidian-memoryd.exe ./cmd/obsidian-memoryd`
y crea un acceso directo en `shell:startup` a `obsidian-memoryd watch --vault "<VAULT>"`. Salud
del daemon: `obsidian-memoryd doctor`.

## Paso 7 (opcional) — Búsqueda híbrida (vaults grandes)

Si el vault es grande y se quiere búsqueda por palabra y por significado:

```bash
pip install -e "<KIT_ROOT>/packages/obsidian-memory-rag"
node "<KIT_ROOT>/packages/create-obsidian-memory/src/index.js" \
  --non-interactive --vault "<VAULT>" --with-hybrid --repo-root "<KIT_ROOT>"
```

En **Claude Code**, añade `--ide claude` (registra vía `claude mcp add`, no `mcp.json`) y
`--build-index` para construir el índice en el mismo comando:

```bash
pip install -e "<KIT_ROOT>/packages/obsidian-memory-rag"
node "<KIT_ROOT>/packages/create-obsidian-memory/src/index.js" \
  --non-interactive --vault "<VAULT>" --ide claude --with-hybrid --build-index --repo-root "<KIT_ROOT>"
```

Reinicia el IDE. Construye el índice con `vault_fts_index` (usa `semantic: true` para los
vectores) y busca con `vault_hybrid_search`.

## Resumen final

Reporta una tabla de estado: vault creado (`<VAULT>`), `basic-memory` en `mcp.json` (✓), User
Rules pegadas (✓), MCP verificado (✓/✗ + instrucción), git sync (opcional), híbrido (opcional).
Recuérdale que en el siguiente chat el agente leerá `START_HERE.md` → `MEMORY.md` →
`PROJECTS/<proyecto>.md` al inicio de cada tarea.

---

— fin del bloque para pegar —
