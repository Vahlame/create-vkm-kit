# Ultra-prompt macOS (v1 legacy) — sustituido por v2

El flujo **Windows-only** completo del ultra-prompt v1 está archivado en `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`.

**Hoy (v2):** **uv** + **Node 20+**, MCP **`uvx basic-memory mcp`** con `BASIC_MEMORY_HOME` = ruta absoluta del vault. Lee `README.md` / `README.en.md` y `AGENTS.md`; valida con `docs/testing/manual-checks.md`.

**Daemon (macOS):** compila `obsidian-memoryd` (`go build ./cmd/obsidian-memoryd`) y usa `watch` o integra el binario en **launchd** según tu política local (plantillas genéricas no duplican el v1 Windows aquí).

**Cierre v1 → v2:** `docs/migration/v1-prompt-closure.md`.

No mantenemos un ultra-prompt macOS línea a línea del v1: reduce deriva y duplicación frente al kit v2 en este repo.
