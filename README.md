# Memoria de agente con Markdown + MCP (kit v3)

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](./LICENSE)
[![Versión](https://img.shields.io/badge/release-v3.0.0--dev-orange.svg)](./CHANGELOG.md)
[![CI](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml)
[![Eval adherencia](https://img.shields.io/badge/eval-adherence-1.0-brightgreen.svg)](./evals/README.md)

> Idiomas: **Español** | [English](./README.en.md)

## Tu camino (orden recomendado)

> **Migración de modelo (v2 → v3, todo en `main`):** el kit **ya no incluye** scripts Windows en `scripts/windows/` ni `tools/*.ps1` para integración; el capítulo y la tabla de sustitución están en [`docs/migration/v2-to-v3-script-free-kit.md`](./docs/migration/v2-to-v3-script-free-kit.md).

1. **[`GETTING_STARTED.md`](./GETTING_STARTED.md)** — tabla paso a paso (flujo lineal; sin saltos).
2. **[`docs/how-memory-works-simple.md`](./docs/how-memory-works-simple.md)** — qué es el vault, el MCP y las User Rules, en palabras simples.
3. **Cursor:** [`docs/cursor-memory-setup.md`](./docs/cursor-memory-setup.md) (MCP + bloque User Rules listo para pegar; stdio vs URL y `memory://`).
4. **Probar que todo responde:** [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md) **; Windows (tareas opcionales + git + MCP HTTP, p. ej. 8765):** [`docs/testing/windows-memory-sync-smoke.md`](./docs/testing/windows-memory-sync-smoke.md).
5. **Algo falla:** [`docs/troubleshooting.md`](./docs/troubleshooting.md) (incluye ventanas de consola que parpadean; diagnóstico con **Administrador de tareas** / **Monitor de recursos**).
6. **MCP `basic-memory` por HTTP (opcional, Windows):** [`docs/setup/windows-basic-memory-always-on.md`](./docs/setup/windows-basic-memory-always-on.md) — solo si no basta con **stdio**; sin scripts del kit.
7. **Git del vault (opcional):** [`docs/setup/windows-scheduled-vault-sync.md`](./docs/setup/windows-scheduled-vault-sync.md) (`obsidian-memoryd` o git manual).
8. **Sin automatismos extra en tu PC:** memoria en el mismo repo que ya actualizas con git — [`docs/setup/memory-repo-sin-automatismos-locales.md`](./docs/setup/memory-repo-sin-automatismos-locales.md).
9. **Windows: sin ventanas CMD / tirones (workspace + tareas + juego):** [`docs/setup/windows-sin-consola-visible.md`](./docs/setup/windows-sin-consola-visible.md) · [`docs/setup/windows-juego-vault-sync.md`](./docs/setup/windows-juego-vault-sync.md).
10. **Vault ya creado:** vuelve a ejecutar `npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "RUTA"` para **fusionar** en el vault el `.vscode/settings.json` calmado (no borra tus claves extra).

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
