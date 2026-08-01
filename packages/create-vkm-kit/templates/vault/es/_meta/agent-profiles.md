# Perfiles de agente (qué modelo, y en qué destaca)

Este vault lo pueden conducir distintos modelos, cada uno con fortalezas distintas al decidir qué hacer.
En una tarea no trivial, lee **tu** fila, sigue su ajuste y **añade una observación de una línea** cuando
un modelo destaque o falle claramente en un tipo de tarea — con el tiempo aprende el mejor modelo por trabajo.

> Defaults de partida — generales, y evolucionan. Corrígelos con observaciones reales abajo.
>
> **Mantenimiento por generación:** estas filas caducan cuando cambia el modelo (lo que
> servía para opus 4.8 puede no servir para opus 5). El hook de SessionStart avisa con una
> línea al detectar el cambio; en la primera sesión con un modelo nuevo, relee tu fila como
> **hipótesis**, confírmala o corrígela con una observación fechada, y poda observaciones de
> generaciones que ya no uses.

| Modelo | Fortaleza al decidir | Aprovéchalo para | Ajusta la memoria |
| --- | --- | --- | --- |
| Claude Opus / Sonnet | Sigue instrucciones + tool use fiable, multi-paso | refactors agénticos, revisiones, autocrítica | self-check completo + coaching; contexto largo OK pero passage-first |
| Cursor Composer | Edición multi-archivo rápida en el IDE | cambios mecánicos amplios | acción primero; apóyate en STACKS/; menos deliberación |
| GPT (incl. razonadores) | Planificación + orquestación de tools | descomponer tareas difusas, multi-tool | descompón explícito; verifica resultados de tools |
| DeepSeek (V3 / R1) | Razonamiento profundo de código/mates, barato | lógica / algoritmos difíciles | permite un self-check más profundo; notas concisas |
| Gemini | Contexto enorme, multimodal | síntesis de muchos archivos / docs largos | puede cargar más, pero passage-first sigue ganando en coste |

## Observaciones (evolutivo — una línea cada una)

Formato: `fecha · modelo · tipo de tarea · qué funcionó / qué evitar`

<!-- example -->

- 2026-01-15 · Composer · cambio auth/seguridad · se le escapó un caso RLS → añade un self-check de Claude para trabajo sensible a seguridad
