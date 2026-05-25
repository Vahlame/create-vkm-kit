# Memoria de agente con Markdown + MCP (kit v3)

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](./LICENSE)
[![Versión](https://img.shields.io/badge/release-v3.0.0--dev-orange.svg)](./CHANGELOG.md)
[![CI](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/Vahlame/cursor-obsidian-memory-guide/actions/workflows/ci.yml)

> Idiomas: **Español** | [English](./README.en.md)

## Empieza aquí — elige una ruta

| Tu situación                                       | Lee                                                                                 | Tiempo  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------- |
| **Quiero que el agente lo instale por mí**         | [`INSTALAR_MEMORIA.md`](./INSTALAR_MEMORIA.md) — pégalo en un chat nuevo de Cursor  | ~5 min  |
| **Voy paso a paso (manual, lineal)**               | [`GETTING_STARTED.md`](./GETTING_STARTED.md) — tabla con cada paso explicado        | ~15 min |
| **Sólo quiero entender la idea antes de instalar** | [`docs/how-memory-works-simple.md`](./docs/how-memory-works-simple.md) — sin código | ~5 min  |

Las tres rutas convergen en lo mismo: un **vault Markdown + git** que la IA lee y escribe vía **MCP** (`basic-memory` por defecto).

<details>
<summary><b>Referencia completa (especializaciones opcionales)</b></summary>

> **Migración v2 → v3 (todo en `main`):** el kit **ya no incluye** scripts Windows en `scripts/windows/` ni `tools/*.ps1`; ver [`docs/migration/v2-to-v3-script-free-kit.md`](./docs/migration/v2-to-v3-script-free-kit.md).

1. **Cursor (detalle):** [`docs/cursor-memory-setup.md`](./docs/cursor-memory-setup.md) — MCP + User Rules listo para pegar; stdio vs URL y `memory://`.
2. **Probar que MCP responde:** [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md); Windows extra: [`docs/testing/windows-memory-sync-smoke.md`](./docs/testing/windows-memory-sync-smoke.md).
3. **Algo falla:** [`docs/troubleshooting.md`](./docs/troubleshooting.md) — incluye consolas que parpadean; diagnóstico con **Administrador de tareas**.
4. **MCP por HTTP (opcional, Windows):** [`docs/setup/windows-basic-memory-always-on.md`](./docs/setup/windows-basic-memory-always-on.md) — sólo si stdio no basta.
5. **Git del vault (opcional):** [`docs/setup/windows-scheduled-vault-sync.md`](./docs/setup/windows-scheduled-vault-sync.md) (`obsidian-memoryd` o git manual).
6. **Sin automatismos extra en tu PC:** memoria en el mismo repo git que ya actualizas — [`docs/setup/memory-repo-sin-automatismos-locales.md`](./docs/setup/memory-repo-sin-automatismos-locales.md).
7. **Windows sin ventanas CMD / tirones (gaming):** [`docs/setup/windows-sin-consola-visible.md`](./docs/setup/windows-sin-consola-visible.md) · [`docs/setup/windows-juego-vault-sync.md`](./docs/setup/windows-juego-vault-sync.md).
8. **Vault ya creado:** vuelve a ejecutar el inicializador para **fusionar** config sin perder claves:
   - Solo `basic-memory`: `npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "RUTA"`
   - Con híbrido FTS: `node packages/create-obsidian-memory/src/index.js --non-interactive --vault "RUTA" --with-hybrid --repo-root "RUTA_DEL_CLON"` (instala antes `pip install -e packages/obsidian-memory-rag`).

</details>

## Qué es este repo (una viñeta)

Kit **multiplataforma** para que la IA lea y escriba **tus** notas Markdown vía **MCP** (`basic-memory` por defecto), con piezas opcionales: índice **FTS5** local, **MCP híbrido** en el IDE, y daemon **Go** para git. Las decisiones de diseño están en [`docs/adr/`](./docs/adr/).

## Snippet MCP mínimo (referencia rápida)

```json
{
  "mcpServers": {
    "basic-memory": {
      "command": "uvx",
      "args": ["--from", "basic-memory==0.21.4", "basic-memory", "mcp"],
      "env": { "BASIC_MEMORY_HOME": "/ruta/absoluta/al/vault" }
    }
  }
}
```

> **Nota de seguridad:** el `--from "basic-memory==0.21.4"` **pinea** la versión. Sin pin, `uvx` baja la última de PyPI en cada arranque de Cursor — si el paquete se compromete (account takeover, squatting), el modelo ejecuta código arbitrario con tus permisos. Para actualizar, sube el pin a mano tras revisar el changelog de basic-memory.

Plantilla y variantes: [`config/mcp/`](./config/mcp/).

## Comparación, privacidad, contribuir

- Honestidad vs otras soluciones: [`docs/comparison.md`](./docs/comparison.md).
- Privacidad / telemetría: [`docs/observability.md`](./docs/observability.md).
- Contribuir y ADRs: [`CONTRIBUTING.md`](./CONTRIBUTING.md) y [`docs/adr/`](./docs/adr/).
- Instrucciones para agentes que tocan **este** repo: [`AGENTS.md`](./AGENTS.md).
- Índice de documentación: [`docs/README.md`](./docs/README.md).

## Licencia

MIT (`LICENSE`).
