# SESSION LOG

## 2026-04-12

- example-app: elegimos `pnpm` sobre `npm` para workspaces -> velocidad y store global compartido entre proyectos.
- example-app: descartamos Drizzle para v1 -> Supabase JS client ya cubre el caso y reduce dependencias.

## 2026-04-15

- example-app: bug "loading screen frozen on Windows" causa = Stronghold bloqueando bootstrap -> fix en `src-tauri/src/setup.rs` con timeout de 5s y fallback en memoria.
- preferencias globales: actualizar `MEMORY.md` con la regla "Tauri 2 Windows no bloquear bootstrap en SQLite/Stronghold".

## 2026-04-22

- example-app: decidimos no usar Supabase Realtime para v1 -> cargar el dashboard al primer render es suficiente; agregar realtime en v2 si la UX lo pide.
- hipotesis: la barra de progreso del importador pierde precision en archivos >100MB. Pendiente medir con un CSV real.

## 2026-05-01

- example-app: medido el importador (hipotesis del 22). Confirmado: la barra rebota porque el callback de progreso usa `len()` de chunks, no bytes leidos. Fix = pasar bytes acumulados al evento.
- aprendizaje: rotar `SESSION_LOG.md` cuando crezca para que el contexto del modelo no se sature. En v3 no se mueve a mano: `obsidian-memory-rag rotate-log` archiva las entradas viejas a `SESSION_LOG/archive.md`.

## 2026-05-13

- repo `cursor-obsidian-memory-guide`: cierre de v1.0.0 -> ver `PROJECTS/cursor-obsidian-memory-guide.md` (CHANGELOG, ADRs, CI, examples, schema). Decision principal: mantener "scripts solo en el vault" como invariante, agregar Uninstall y Repair al prompt.
