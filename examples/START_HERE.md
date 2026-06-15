---
type: index
tags: [start, navigation, example]
status: active
created: 2026-05-13
updated: 2026-05-13
---

# START HERE (example)

This is a **fictional** vault index. Copy the idea, not the prose.

## Reading order for the agent

1. This file.
2. `MEMORY.md`.
3. `PROJECTS/<project>.md` for the active workspace.
4. On demand: `RULES/<project>.md`, sprint logs, runbooks, `KNOWN_FAILURES.md`, `TAGS.md`.

## Vault health (v3, kit público)

- **Git:** `git status` o el panel Source Control del IDE; sync opcional con **`obsidian-memoryd watch`** (debounce; compilar con `-ldflags="-H windowsgui"` en Windows si no quieres consola) o **git manual**.
- **MCP / IDE:** la entrada MCP vive en la config del IDE (p. ej. `%USERPROFILE%\.cursor\mcp.json`); las **User Rules** son ajustes del IDE. Este repo de notas es solo Markdown + `.vscode` del workspace.
- **Híbrido FTS (opcional):** búsqueda **passage-first** con `vault_hybrid_search` (BM25 + semántico vía RRF; devuelve la sección relevante, no la nota entera) o `vault_fts_search` (BM25 léxico para términos exactos); (re)construye el índice con `vault_fts_index` (`semantic: true` para los vectores). Todo vía MCP `obsidian-memory-hybrid`.
- **Salud del vault:** `vault_audit` valida frontmatter, wikilinks rotos y notas huérfanas; fusiona el híbrido con el inicializador `create-obsidian-memory --ide cursor,claude --with-hybrid --build-index --semantic --repo-root <clon-del-kit>` (necesita `pip install -e packages/obsidian-memory-rag` previo; ver `docs/es/instalacion.md`).
- **Guía del kit:** [`docs/es/instalacion.md`](../docs/es/instalacion.md) y [`docs/es/como-funciona.md`](../docs/es/como-funciona.md).
