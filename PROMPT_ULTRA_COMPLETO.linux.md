# Ultra-prompt Linux (v1 legacy) — sustituido por v2

El flujo **Windows-only** completo del ultra-prompt v1 está archivado en `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md` (Task Scheduler, `mcp-remote`, SSE local).

**Hoy (v2):** instala **uv**, **Node 20+**, configura MCP con **`uvx basic-memory mcp`** y `BASIC_MEMORY_HOME` apuntando a tu vault. Guía canónica: `README.md` / `README.en.md`, memoria del agente: `AGENTS.md`, checklist: `docs/testing/manual-checks.md`.

**Daemon de sync (Linux):** `go build -o obsidian-memoryd ./cmd/obsidian-memoryd` y `obsidian-memoryd service install --user` (unit systemd usuario; ver ayuda del binario).

**Cierre v1 → v2:** `docs/migration/v1-prompt-closure.md`.

No mantenemos un ultra-prompt Linux párrafo a párrafo equivalente al v1: el mantenimiento vive en este repo y en tu vault privado.
