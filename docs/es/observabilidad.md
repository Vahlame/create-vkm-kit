> 🇪🇸 Español · [🇬🇧 English](../observability.md)

# Observabilidad

El kit tiene tres superficies de observabilidad. Todas son locales — nada sale de tu máquina.

## 1. Salud del daemon: `obsidian-memoryd doctor`

Si corres el daemon Go (`obsidian-memoryd watch`), llama a `obsidian-memoryd doctor` para ver si está vivo y empujando:

```text
obsidian-memoryd doctor
  state file:               ~/.local/state/obsidian-memory/state.json
  heartbeat:                28s ago
  last successful push:     3m12s ago
  unpushed commits (vault): 0
```

El daemon escribe un heartbeat cada 60 s y registra el timestamp de cada `git push` exitoso, el último rebase abortado y el conteo de fallos de push consecutivos. `doctor` sale con código **distinto de cero** si el heartbeat tiene más de 5 min, el push falló 3+ veces seguidas, el vault falló al sincronizar 3+ veces seguidas, hay un rebase abortado registrado, o el watcher del filesystem no arrancó — conéctalo a un cron / alias de shell para que un fallo silencioso en Windows (el daemon corre con `-H windowsgui`, sin consola) no pase desapercibido.

> ⚠️ **Gotcha de Windows/PowerShell:** en un build `-H windowsgui`, el subcomando `doctor` solo devuelve un `$LASTEXITCODE` fiable y salida completamente ordenada cuando su salida se redirige (pipe) o esperas explícitamente — PowerShell no espera a un proceso de subsistema GUI de otra forma. Ve a `docs/es/troubleshooting.md` ("el exit code de doctor se lee vacío en PowerShell") para la causa confirmada y el patrón de invocación correcto antes de conectar `doctor` a un cron o alias.

## 2. Uso de tokens y caché: `vkm-doctor` (sink OTLP local, ADR-0044)

Cuando el instalador wirea Claude Code (y hay un clon del kit disponible), también apunta el export de métricas OTEL de Claude Code a un sink **local**: un bloque env gestionado más un hook `SessionStart` (`ensure-otel-sink.mjs`) que lanza `vkm-otel-sink` en **`127.0.0.1:4319`** (solo localhost, singleton por lockfile). Las métricas aterrizan como NDJSON bajo `~/.vkm/telemetry/` con poda a 90 días. Sin colector cloud, sin cuentas — los datos nunca salen de la máquina.

Léelo con el CLI:

```bash
vkm-doctor                        # últimos 30 días: tokens, coste, ratio de caché + diagnóstico de caché rota
vkm-doctor --days 7               # ventana más corta
vkm-doctor --json                 # salida legible por máquina
vkm-doctor --include-transcripts  # añade una sección derivada de transcripts, claramente etiquetada
```

El ratio de cache-hit viene con diagnóstico: un ratio consistentemente bajo suele significar una caché de prompt rota (algo muta el system prompt en cada turno) — el multiplicador de coste silencioso más grande que existe. `--include-transcripts` parsea transcripts locales de sesión como **fallback etiquetado** (el formato JSONL de transcripts de Claude Code es interno e inestable — la documentación oficial desaconseja parsearlo); se reporta en su propia sección, nunca mezclado con los números OTEL.

Quita toda la superficie con `--no-telemetry` en un re-run del instalador, o como parte de `--uninstall`.

## 3. Trazas opcionales a nivel MCP (sidecar)

`packages/obsidian-memory-mcp` emite logs JSON de Pino. Si quieres trazas estructuradas:

- El exporter **OpenTelemetry OTLP** es dependencia opcional (`@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`). Instala con `npm install --include=optional` dentro del workspace; apunta `OTEL_EXPORTER_OTLP_ENDPOINT` a tu colector.
- El sidecar propaga `traceparent` W3C vía `_meta` de MCP cuando el host lo soporta.

**No loguees tokens crudos ni PII** en atributos de trazas; prefiere IDs opacos. Los spans deben llevar solo nombres de operación y duraciones.

## Benchmark de rendimiento / retrieval

El objetivo de retrieval híbrido (ADR-0014) es **P95 < 150 ms sobre ~10k chunks**. Mide tu propio
vault con el CLI de bench y anota hardware, embedder y tamaño del vault junto al número:

```bash
obsidian-memory-rag bench --vault "<VAULT>" --iterations 200 --query "memory"
```

La mitad vectorial/semántica del retrieval híbrido **está incluida** (ADR-0017): el
`HashingEmbedder` por defecto (stdlib puro, vectores léxicos) corre out of the box, y el extra
opcional `fastembed` (`pip install 'obsidian-memory-rag[semantic]'` →
`OBSIDIAN_MEMORY_EMBEDDER=fastembed`) añade recall por significado real. La búsqueda es un
full-scan coseno en Python, sub-10 ms para un vault personal. `sqlite-vec` es **aceleración
diferida** para vaults muy grandes — no funcionalidad sin implementar, solo una optimización que
encaja detrás de la misma interfaz `vector_store` cuando el coseno por fuerza bruta deja de ser
rápido (ADR-0014 / ADR-0017).

## Salud del vault

`obsidian-memory-rag audit` (y la tool MCP `vault_audit`) muestra notas sobredimensionadas (por
encima del presupuesto de ~8k tokens), `[[wikilinks]]` rotos (señal de memoria envejecida) y el
tamaño de `SESSION_LOG.md`. `rotate-log` archiva secciones viejas de `SESSION_LOG.md` en
`SESSION_LOG/archive.md`, dejando las más recientes en su sitio (no destructivo). Juntas mantienen
el retrieval barato mientras el vault crece.

| Superficie       | Comando / tool                              | Señales                                                                     |
| ---------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Salud del daemon | `obsidian-memoryd doctor`                   | edad del heartbeat, último push exitoso, fallos de push consecutivos        |
| Tokens/caché     | `vkm-doctor` (sink en `127.0.0.1:4319`)     | tokens, coste, ratio de cache-hit, diagnóstico de caché rota                |
| Trazas MCP       | Pino JSON + exporter OTLP (sidecar)         | nombres de operación, duraciones, propagación `traceparent` W3C             |
| Salud del vault  | `obsidian-memory-rag audit` / `vault_audit` | notas sobredimensionadas, `[[wikilinks]]` rotos, tamaño de `SESSION_LOG.md` |
| Rotación de log  | `obsidian-memory-rag rotate-log`            | archiva secciones viejas de `SESSION_LOG.md` (no destructivo)               |

## Lo que este repo deliberadamente no incluye

Un stack docker-compose para Langfuse / ClickHouse / Redis vivió en `compose.observability.yml`. Se eliminó en v3 porque el daemon y el sidecar nunca conectaron métricas ni trazas a él — mantener el archivo junto a los docs implicaba una historia de instrumentación que no existía. Si quieres un backend completo de observabilidad LLM, corre Langfuse por separado y apunta el exporter OTLP del sidecar hacia él.
