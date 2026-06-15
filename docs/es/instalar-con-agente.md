> 🇪🇸 Español · [🇬🇧 English](../en/install-with-agent.md)

# Instalar con un agente (pégalo en el chat)

¿No quieres seguir la [guía manual](instalacion.md)? Pega el bloque de abajo en un chat de
**Cursor** o **Claude Code**: el agente instala y verifica todo, y tú solo **apruebas los
comandos**. Funciona para ambos IDEs — la instalación básica no necesita clon.

> ## ⚠️ Antes de pegar esto — es una acción tipo `curl … | sh`
>
> El bloque autoriza a un agente a instalar un paquete npm, editar tu config MCP y tocar git.
> Pégalo **solo desde este repo** (<https://github.com/Vahlame/obsidian-memory-kit>) y verifica que
> el paquete que instala es **`@vkmikc/create-obsidian-memory`**. Si algo no cuadra, no pegues nada
> y abre un issue.

---

**Copia desde aquí hacia abajo y pégalo en un chat nuevo del agente:**

---

Eres un agente de Cursor o Claude Code. Instala y **verifica** el sistema de **memoria Markdown**
en esta máquina. Ejecuta cada comando, **reporta su resultado** y pide aprobación antes de
cualquier cosa que instale software.

**1 · Prerrequisitos.** Deben existir; instala lo que falte y luego pídeme reabrir la terminal
para que se refresque el `PATH`:

```bash
node --version   # ≥ 20
uvx --version    # cualquiera — ejecuta el MCP basic-memory
git --version    # cualquiera
```

> Windows: `winget install OpenJS.NodeJS.LTS astral-sh.uv Git.Git` · macOS: `brew install node uv git`.

**2 · Instalar — un solo comando.** Pregúntame la carpeta del vault (por defecto
`~/Documents/obsidian-memory-vault`, en Windows `%USERPROFILE%\Documents\obsidian-memory-vault`);
llámala `<VAULT>`. Ejecuta la línea del IDE en el que corres — pregúntame si no estás seguro:

```bash
# Cursor
npx @vkmikc/create-obsidian-memory "<VAULT>" -y --rules all

# Claude Code  (registra vía `claude mcp add`, no mcp.json)
npx @vkmikc/create-obsidian-memory "<VAULT>" -y --ide claude --rules all
```

Un comando hace todo: crea el vault si no existe (`START_HERE.md`, `MEMORY.md`, `SESSION_LOG.md`,
`PROJECTS/`), conecta el MCP **`basic-memory`** con versión fijada (haciendo backup de tu config
previa primero), e instala las **User Rules** de memoria como bloque marcado idempotente en
`~/.claude/CLAUDE.md`, `./AGENTS.md` y `.cursor/rules/` (nunca pisa tu contenido). Muestra la
salida y confirma que no hubo errores.

**3 · User Rules globales de Cursor (solo Cursor).** El Paso 2 ya escribió la regla de _proyecto_
(`.cursor/rules/obsidian-memory.mdc`). Para cobertura _global_, muéstrame el bloque marcado (entre
los marcadores `obsidian-memory:start`/`end`) y dime que lo pegue en
**Cursor → Settings → Rules → User Rules** — Cursor guarda las reglas globales fuera de cualquier
archivo. **Claude Code: omite esto** — `~/.claude/CLAUDE.md` ya quedó hecho.

**4 · Reinicia y verifica.** Dime que ejecute **Developer: Reload Window** (Cursor) o reinicie
Claude Code. Luego, en un chat nuevo, comprueba que funciona:

```text
Lee START_HERE.md de mi vault y dime qué contiene.
```

Si vuelve el contenido, reporta una tabla de estado — vault (`<VAULT>`) ✓ · MCP conectado ✓ ·
reglas instaladas ✓ · prueba de lectura ✓. Si falla, consulta
[`troubleshooting.md`](troubleshooting.md) → **MCP / Cursor**.

**5 · (Opcional) Búsqueda híbrida — solo vaults grandes.** Buscar por palabra **y** por significado
necesita el kit **clonado** y Python ≥ 3.11. Pídeme una ruta de clon `<KIT>` y luego:

```bash
git clone https://github.com/Vahlame/obsidian-memory-kit "<KIT>"
pip install -e "<KIT>/packages/obsidian-memory-rag[semantic]"
node "<KIT>/packages/create-obsidian-memory/src/index.js" -y --vault "<VAULT>" --with-hybrid --semantic --build-index --repo-root "<KIT>"
```

En Claude Code añade `--ide claude` a la última línea. Reinicia el IDE; entonces responden las
tools `obsidian-memory-hybrid` (`vault_hybrid_search`, …).

---

— fin del bloque para pegar —

> ¿Montas una **máquina nueva completa** (clonar tu repo privado del vault, `CLAUDE.md` global y el
> índice semántico de una vez)? Usa [`instalar-pc-nueva.md`](instalar-pc-nueva.md) en su lugar.
