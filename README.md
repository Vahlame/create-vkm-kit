# Memoria de agente con Markdown + MCP (v2)

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](./LICENSE)
[![Versión](https://img.shields.io/badge/release-v2.0.0--dev-orange.svg)](./CHANGELOG.md)
[![CI](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml)
[![Eval adherencia](https://img.shields.io/badge/eval-adherence-1.0-brightgreen.svg)](./evals/README.md)

> Idiomas: **Español** | [English](./README.en.md)

## Por qué existe

Los modelos no recuerdan entre sesiones. Externalizar memoria en **Markdown versionado** + **MCP** te da propiedad de datos, auditoría con `git log`, y portabilidad entre IDEs. v2 rompe el lock-in a Windows/Cursor únicamente: **Linux/macOS/Windows**, `AGENTS.md` canónico, servidor **`basic-memory`**, y daemon Go opcional.

## Instalación en 1 minuto (rápido)

1. Instala **uv** / Python y **Node 20+**.
2. Copia `config/mcp/basic-memory.json` a tu `mcp.json` del IDE y reemplaza `<VAULT_PATH>`.
3. Ejecuta `uvx basic-memory mcp` (Inspector: ver `docs/testing/manual-checks.md`).
4. (Opcional) `go build -o obsidian-memoryd ./cmd/obsidian-memoryd` y `obsidian-memoryd watch`.
5. (Opcional, bóvedas grandes) `pip install -e ./packages/obsidian-memory-rag` y `obsidian-memory-rag index --vault <ruta>` para búsqueda **FTS5** local (`search` / `bench`). MCP híbrido en IDE: `config/mcp/obsidian-memory-hybrid.json` (`vault_fts_search` / `vault_fts_index`).

Flujo guiado: `npx @vahlame/create-obsidian-memory@next` (fusiona **`basic-memory`** en `~/.cursor/mcp.json` de Cursor si lo eliges; usa `--dry-run` para ver el JSON sin escribir). En CI/scripts: `npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault <ruta> [--dry-run]`.

## Cómo funciona

```text
         +----------------+
         |  IDE / agente  |
         +-------+--------+
                 | MCP (stdio / streamable HTTP)
                 v
         +----------------+       +------------------+
         | basic-memory   | ----> | vault Markdown   |
         +----------------+       +---------+--------+
                                           | git
                                           v
                                  +------------------+
                                  | remoto (GitHub)  |
                                  +------------------+

 opcional: obsidian-memoryd (fsnotify + git sync)
 opcional: obsidian-memory-rag (FTS5) + MCP híbrido `obsidian-memory-hybrid` (vault_fts_search / vault_fts_index)
```

## Casos de uso

- Memoria personal por proyecto (`PROJECTS/<nombre>.md`).
- Bitácora de decisiones (`SESSION_LOG.md`).
- Runbooks y reglas duras (`RULES/`, `KNOWN_FAILURES.md`).
- Equipos multi-IDE (Cursor, Copilot, Zed, Windsurf, Codex CLI).

## Para devs de productos (snippet embebible)

```json
{
  "mcpServers": {
    "basic-memory": {
      "command": "uvx",
      "args": ["basic-memory", "mcp"],
      "env": { "BASIC_MEMORY_HOME": "/abs/path/to/vault" }
    }
  }
}
```

## Aviso de privacidad

Este repo **no** recopila tus datos. Todo corre local salvo el remoto que **tú** configures. Si activas **Langfuse / OTel**, revisa retención y evita PII en atributos (`docs/observability.md`).

## Observabilidad

- Pino + JSONL rotado (`packages/obsidian-memory-mcp`).
- OTLP opcional + stack Langfuse (`compose.observability.yml`).

## Comparación honesta vs alternativas

Ver [`docs/comparison.md`](./docs/comparison.md).

## Migración desde v1

- Cierre objetivos v1 → piezas v2: [`docs/migration/v1-prompt-closure.md`](./docs/migration/v1-prompt-closure.md).
- Prompt histórico (Windows): `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`.
- Atajos Linux / macOS (redirección a v2): [`PROMPT_ULTRA_COMPLETO.linux.md`](./PROMPT_ULTRA_COMPLETO.linux.md), [`PROMPT_ULTRA_COMPLETO.macos.md`](./PROMPT_ULTRA_COMPLETO.macos.md).
- Tabla de herramientas MCP: `docs/migration/v1-to-v2-mcp.md`.
- Scripts Windows v1: `docs/legacy/windows-v1/README.md`.

## Contribuir / ADRs

`CONTRIBUTING.md` y `docs/adr/`. Cambios de arquitectura requieren ADR.

## Licencia

MIT (`LICENSE`).
