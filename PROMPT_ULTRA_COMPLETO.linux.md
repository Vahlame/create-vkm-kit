# Nombre histórico en disco — usar solo el kit v2

Este archivo conserva una ruta conocida por enlaces antiguos. **El flujo actual** es el del repo en **v2**:

- [`README.md`](./README.md) / [`README.en.md`](./README.en.md)
- [`GETTING_STARTED.md`](./GETTING_STARTED.md) / [`GETTING_STARTED.en.md`](./GETTING_STARTED.en.md)
- [`AGENTS.md`](./AGENTS.md) y [`docs/testing/manual-checks.md`](./docs/testing/manual-checks.md)

**Daemon de sync (Linux):** `go build -o obsidian-memoryd ./cmd/obsidian-memoryd` y `obsidian-memoryd service install --user` (unidad systemd de usuario; ver ayuda del binario).

No se mantiene aquí un “ultra-prompt” monolítico por SO: el mantenimiento vive en este repo y en tu vault privado.
