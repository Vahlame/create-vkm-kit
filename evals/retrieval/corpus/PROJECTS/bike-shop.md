---
type: project
created: 2026-01-02
tags: [tauri, svelte, supabase]
---

# bike-shop

Taller de reparacion de bicicletas en Liberia, Costa Rica. Migracion big-bang
desde Next.js a un cliente de escritorio.

## Stack

- Shell de escritorio: Tauri 2 (webview nativo + sidecar Rust minimo).
- UI: Svelte 5 con runes; reactividad sin VDOM.
- Backend y datos: Supabase (Postgres gestionado) con realtime.
- Estilos: Tailwind responsive 2D.

## Decisiones

- Sincronizacion de inventario de repuestos en tiempo real via canales Supabase.
- Ordenes de trabajo del taller con estados: recibida, en reparacion, lista.

Relacionado: [[STACKS/tauri]], [[STACKS/svelte]], [[STACKS/postgres]].
