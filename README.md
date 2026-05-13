# Memoria de agente con Markdown + MCP (v2)

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](./LICENSE)
[![Versión](https://img.shields.io/badge/release-v2.0.0--dev-orange.svg)](./CHANGELOG.md)
[![CI](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml)
[![Eval adherencia](https://img.shields.io/badge/eval-adherence-1.0-brightgreen.svg)](./evals/README.md)

> Idiomas: **Español** | [English](./README.en.md)

## Tu camino (orden recomendado)

1. **[`GETTING_STARTED.md`](./GETTING_STARTED.md)** — tabla paso a paso (flujo lineal; sin saltos).
2. **[`docs/how-memory-works-simple.md`](./docs/how-memory-works-simple.md)** — qué es el vault, el MCP y las User Rules, en palabras simples.
3. **Cursor solamente:** [`docs/cursor-memory-setup.md`](./docs/cursor-memory-setup.md) (MCP + bloque User Rules listo para pegar).
4. **Probar que todo responde:** [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md).
5. **Algo falla:** [`docs/troubleshooting.md`](./docs/troubleshooting.md).

Si vienes de v1 Windows: [`docs/migration/v1-prompt-closure.md`](./docs/migration/v1-prompt-closure.md) después del paso 2.

## Qué es este repo (una viñeta)

Un kit **multiplataforma** para que la IA lea y escriba **tus** notas Markdown vía **MCP** (`basic-memory` por defecto), con piezas opcionales: índice **FTS5** local, **MCP híbrido** en el IDE, y daemon **Go** para git. Las decisiones de diseño están en [`docs/adr/`](./docs/adr/).

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

## Licencia

MIT (`LICENSE`).
