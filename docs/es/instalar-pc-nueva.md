> 🇪🇸 Español · [🇬🇧 English](../en/install-fresh-pc.md)

# Instalar en un PC nuevo (Claude Code)

Reproduce **toda** tu memoria en una máquina recién formateada: las notas, el MCP, la búsqueda
semántica y las reglas de ahorro. Hay dos caminos; ambos terminan igual.

> Para **Cursor** (no Claude Code) el camino es el inicializador `npx` — ver
> [`instalacion.md`](instalacion.md). Esta página es específica de **Claude Code** porque su MCP
> se registra con `claude mcp …`, no con `mcp.json`.

## Lo único que haces tú a mano (no se puede arrancar de la nada)

1. **Instalar Claude Code** en el PC nuevo (no se puede bootstrappear a sí mismo).
2. **Tener acceso a tu repo de vault privado** (tu cuenta de GitHub con la clave/login listos).

Lo demás lo automatiza uno de los dos caminos.

---

## Camino A — el agente lo instala (asistencia mínima) ⭐

Abre Claude Code en el PC nuevo y **pega el bloque de abajo** en un chat nuevo. El agente
verifica prerrequisitos, clona, registra el MCP, construye el índice y verifica. Tú solo
**apruebas** los comandos.

> ⚠️ Igual que un `curl … | sh`: este bloque autoriza a un agente a instalar software y editar
> tu config. Pégalo solo desde una fuente que confíes (este repo).

**Copia desde aquí hacia abajo:**

---

Eres un agente de Claude Code. Instala el **sistema de memoria Markdown** en este PC nuevo.
Ejecuta cada paso, **reporta el resultado** y pide aprobación antes de comandos que instalen
software. Variables: `<KIT>` = ruta donde clonarás el kit; `<VAULT>` = ruta del vault;
`<VAULT_GIT_URL>` = URL del repo privado de notas (pídemela si no la sabes).

1. **Prerrequisitos.** Comprueba `node --version` (≥20), `uvx --version`, `python --version`
   (≥3.11), `git --version`. Instala los que falten (Windows: `winget install OpenJS.NodeJS.LTS`,
   `winget install astral-sh.uv`, `winget install Python.Python.3.12`, `winget install Git.Git`;
   macOS: `brew install node uv python git`). Avísame y **reabre la terminal** tras instalar.
2. **Clona el kit:** `git clone https://github.com/Vahlame/cursor-obsidian-memory-guide "<KIT>"`.
3. **Clona el vault:** `git clone "<VAULT_GIT_URL>" "<VAULT>"` (pídeme la URL privada).
4. **Backend Python + semántico:** `pip install -e "<KIT>/packages/obsidian-memory-rag[semantic]"`.
5. **Registra el MCP en Claude Code (scope `user` = todos los chats).** Si un servidor ya existe,
   primero `claude mcp remove <nombre> -s user`. Luego:

   ```bash
   claude mcp add basic-memory -s user \
     -e BASIC_MEMORY_HOME="<VAULT>" \
     -- uvx --from basic-memory==0.21.4 basic-memory mcp

   claude mcp add obsidian-memory-hybrid -s user \
     -e BASIC_MEMORY_HOME="<VAULT>" \
     -e PYTHONPATH="<KIT>/packages/obsidian-memory-rag/src" \
     -e PYTHONUTF8=1 \
     -e OBSIDIAN_MEMORY_EMBEDDER="fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2" \
     -- node "<KIT>/packages/obsidian-memory-mcp/src/hybrid-mcp.mjs"
   ```

6. **Construye el índice (con vectores semánticos):**

   ```bash
   PYTHONPATH="<KIT>/packages/obsidian-memory-rag/src" python -m obsidian_memory_rag index \
     --vault "<VAULT>" --semantic \
     --embedder "fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
   ```

7. **Reglas globales (passage-first + ahorro).** Abre `<KIT>/docs/es/instalacion.md`, copia el
   **bloque de User Rules del Paso 4**, y pégalo/anéxalo en `~/.claude/CLAUDE.md` (Claude Code lo
   carga en cada sesión). Si ya tengo un `CLAUDE.md` global, intégralo sin borrar lo mío.
8. **(Opcional) Sincronización git** del vault: ver `<KIT>/docs/es/sincronizacion.md`.
9. **Verifica:** `claude mcp list` debe mostrar `basic-memory` y `obsidian-memory-hybrid` en
   **✓ Connected**. Reinicia Claude Code. En un chat nuevo, una `vault_hybrid_search` debe
   devolver un **pasaje** (no la nota entera). Reporta una tabla de estado final.

— fin del bloque para pegar —

---

## Camino B — comandos manuales (repetible)

Mismos pasos, sin agente. Sustituye `<KIT>`, `<VAULT>`, `<VAULT_GIT_URL>` por tus rutas/URL.

```bash
# 0) Prerrequisitos (ejemplo Windows; macOS: brew install node uv python git)
winget install OpenJS.NodeJS.LTS astral-sh.uv Python.Python.3.12 Git.Git
#    cierra y reabre la terminal para refrescar el PATH

# 1-3) Clonar kit + vault, instalar backend semántico
git clone https://github.com/Vahlame/cursor-obsidian-memory-guide "<KIT>"
git clone "<VAULT_GIT_URL>" "<VAULT>"
pip install -e "<KIT>/packages/obsidian-memory-rag[semantic]"

# 4) Registrar MCP en Claude Code (scope user). Si ya existen: claude mcp remove <nombre> -s user
claude mcp add basic-memory -s user -e BASIC_MEMORY_HOME="<VAULT>" -- uvx --from basic-memory==0.21.4 basic-memory mcp
claude mcp add obsidian-memory-hybrid -s user -e BASIC_MEMORY_HOME="<VAULT>" -e PYTHONPATH="<KIT>/packages/obsidian-memory-rag/src" -e PYTHONUTF8=1 -e OBSIDIAN_MEMORY_EMBEDDER="fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2" -- node "<KIT>/packages/obsidian-memory-mcp/src/hybrid-mcp.mjs"

# 5) Índice semántico
PYTHONPATH="<KIT>/packages/obsidian-memory-rag/src" python -m obsidian_memory_rag index --vault "<VAULT>" --semantic --embedder "fastembed:sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

# 6) Verificar
claude mcp list   # ambos en ✓ Connected
```

Luego copia el bloque de User Rules ([Paso 4 de la instalación](instalacion.md#paso-4--pegar-las-user-rules-en-cursor)) a `~/.claude/CLAUDE.md` y **reinicia Claude Code**.

---

## ¿Qué NO necesitas copiar?

- **El índice `.obsidian-memory-rag/`** — está gitignored a propósito (binario regenerable). Por
  eso el paso 5 lo reconstruye en cada PC.
- **`fastembed` / el modelo** — se instala con el extra `[semantic]` (paso 4) y el modelo se
  descarga solo la primera vez que se usa.

## Verificación rápida

| Comprobación                     | Esperado                                                |
| -------------------------------- | ------------------------------------------------------- |
| `claude mcp list`                | `basic-memory` y `obsidian-memory-hybrid` → ✓ Connected |
| `vault_hybrid_search` en un chat | devuelve **heading + sección**, con `_trust`            |
| `vault_audit`                    | JSON de salud (oversized, links, SESSION_LOG)           |

Si algo falla → [`troubleshooting.md`](troubleshooting.md).
