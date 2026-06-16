---
type: topic
created: 2026-01-07
tags: [stack, desktop]
---

# tauri

Framework de aplicaciones de escritorio: webview nativo del sistema + un binario
Rust pequeno. Verdict: like.

## Notas tecnicas

- Sidecar Rust minimo para llamadas nativas; el grueso de la UI es web.
- En Windows el arranque no debe bloquearse esperando SQLite ni Stronghold.
- Comunicacion LAN entre instancias para apps multi-dispositivo.

## Veces visto

- bike-shop, exam-generator.
