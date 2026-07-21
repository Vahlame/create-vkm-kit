> 🇪🇸 Español · [🇬🇧 English](./mcp-remote-rce.md)

# Pin de mcp-remote por RCE (>= 0.1.16)

## Contexto

Versiones antiguas de `mcp-remote` tuvieron problemas de seguridad (incluidos bugs de clase RCE en el manejo de dependencias / bridge). Upstream los arregló en la línea **0.1.16**.

## Decisión

Documentar y forzar **`mcp-remote@^0.1.16` como mínimo** allí donde todavía hagamos bridge STDIO ↔ HTTP/SSE (configs legacy de Cursor, setups de transición). Prefiere clientes nativos de **Streamable HTTP** cuando existan.

## Qué debes hacer

- En `package.json` / salida del inicializador / docs: nunca pinnear por debajo de `0.1.16`.
- Corre `npm ls mcp-remote` tras merges que toquen bridges MCP.

## Referencias

- **No hay CVE público** rastreado aquí; esta guía se basa en el changelog / notas de
  release de `mcp-remote` upstream, no en un advisory numerado. Revisa el changelog del
  registry (`npm view mcp-remote`) al subir el pin.
- Modelo de seguridad del kit y proceso de divulgación: [`../../SECURITY.md`](../../SECURITY.md).
