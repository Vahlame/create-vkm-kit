# Memoria de agente con Markdown + MCP (kit v2)

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](./LICENSE)
[![Versión](https://img.shields.io/badge/release-v2.0.0--dev-orange.svg)](./CHANGELOG.md)
[![CI](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml)
[![Eval adherencia](https://img.shields.io/badge/eval-adherence-1.0-brightgreen.svg)](./evals/README.md)

> Idiomas: **Español** | [English](./README.en.md)

## Tu camino (orden recomendado)

1. **[`GETTING_STARTED.md`](./GETTING_STARTED.md)** — tabla paso a paso (flujo lineal; sin saltos).
2. **[`docs/how-memory-works-simple.md`](./docs/how-memory-works-simple.md)** — qué es el vault, el MCP y las User Rules, en palabras simples.
3. **Cursor:** [`docs/cursor-memory-setup.md`](./docs/cursor-memory-setup.md) (MCP + bloque User Rules listo para pegar; stdio vs URL y `memory://`).
4. **Probar que todo responde:** [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) **; Windows (tareas + git + MCP HTTP, p. ej. 8765):** [`docs/testing/windows-memory-sync-smoke.md`](./docs/testing/windows-memory-sync-smoke.md).
5. **Algo falla:** [`docs/troubleshooting.md`](./docs/troubleshooting.md) (incluye ventanas de consola que parpadean y diagnóstico con [`tools/monitor-console-live.ps1`](./tools/monitor-console-live.ps1)).
6. **MCP `basic-memory` siempre encendido (Windows, HTTP):** [`docs/setup/windows-basic-memory-always-on.md`](./docs/setup/windows-basic-memory-always-on.md).
7. **Autosync del vault con git (Windows, sin consola):** [`docs/setup/windows-scheduled-vault-sync.md`](./docs/setup/windows-scheduled-vault-sync.md).

## Qué es este repo (una viñeta)

Kit **multiplataforma** para que la IA lea y escriba **tus** notas Markdown vía **MCP** (`basic-memory` por defecto), con piezas opcionales: índice **FTS5** local, **MCP híbrido** en el IDE, y daemon **Go** para git. Las decisiones de diseño están en [`docs/adr/`](./docs/adr/).

## Snippet MCP mínimo (referencia rápida)

```json
{
  "mcpServers": {
    "basic-memory": {
      "command": "uvx",
      "args": ["basic-memory", "mcp"],
      "env": { "BASIC_MEMORY_HOME": "/ruta/absoluta/al/vault" }
    }
  }
}
```

Plantilla y variantes: [`config/mcp/`](./config/mcp/).

## Comparación, privacidad, contribuir

- Honestidad vs otras soluciones: [`docs/comparison.md`](./docs/comparison.md).
- Privacidad / telemetría: [`docs/observability.md`](./docs/observability.md).
- Contribuir y ADRs: [`CONTRIBUTING.md`](./CONTRIBUTING.md) y [`docs/adr/`](./docs/adr/).
- Instrucciones para agentes que tocan **este** repo: [`AGENTS.md`](./AGENTS.md).
- Índice de documentación: [`docs/README.md`](./docs/README.md).

## Licencia

MIT (`LICENSE`).
