# Nombre histórico en disco — kit v3 (sin cambios en el protocolo MCP)

Este archivo conserva una ruta conocida por enlaces antiguos. **El flujo actual** es el del repo en **v3** (mismo protocolo MCP, sin scripts `.ps1`/`.vbs` en el kit):

- [`README.md`](./README.md) / [`README.en.md`](./README.en.md)
- [`GETTING_STARTED.md`](./GETTING_STARTED.md) / [`GETTING_STARTED.en.md`](./GETTING_STARTED.en.md)
- [`AGENTS.md`](./AGENTS.md) y [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md)

**Daemon de sync (Linux):** `go build -o obsidian-memoryd ./cmd/obsidian-memoryd` y `obsidian-memoryd service install --user` (unidad systemd de usuario; ver ayuda del binario).

No se mantiene aquí un “ultra-prompt” monolítico por SO: el mantenimiento vive en este repo y en tu vault privado.
