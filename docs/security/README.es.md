> 🇪🇸 Español · [🇬🇧 English](./README.md)

# Docs de seguridad

Notas de seguridad en profundidad del kit. La política canónica — modelo de confianza,
alcance, proceso de divulgación — vive en [`SECURITY.md`](../../SECURITY.md) en la raíz
del repo.

## Modelo de amenazas en un párrafo

La frontera del kit es **tu filesystem y tu remoto git** — no hay autenticación in-band,
no hay backend alojado y nada sale de la máquina por defecto. Las dos defensas activas:
(1) todo lo leído del vault o de la web se envuelve como **DATOS no confiables, nunca
instrucciones** (envelope anti prompt-injection, flags `_trust`), y (2) la superficie de
supply-chain está pinneada y verificada — `basic-memory` con versión fija, el binario de
obscura verificado por SHA-256, `gitleaks` escaneando el historial en CI y `govulncheck`
gateando el daemon Go.

## Notas en este directorio

| Doc                                              | Qué cubre                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [`mcp-remote-rce.es.md`](./mcp-remote-rce.es.md) | Por qué `mcp-remote` debe pinnearse `>= 0.1.16` en cualquier bridge legacy STDIO↔HTTP. |

Relacionado: las garantías de telemetría y privacidad están documentadas en
[`docs/es/observabilidad.md`](../es/observabilidad.md) (todos los sinks solo locales).
