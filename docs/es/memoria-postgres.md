> 🇪🇸 Español · [🇬🇧 English](../en/postgres-memory.md)

# Memoria en Postgres — la proyección del vault

Una capa **opcional** que copia el índice de tu vault a un Postgres local para hacer cosas
que SQLite no hace barato: recorrer el grafo de relaciones a **varios saltos** en una sola
consulta, sacar **analíticas SQL** de todo el vault, guardar un **registro temporal** de qué
cambió y cuándo, y **empujar eventos en tiempo real** a la consola.

No sustituye nada. La búsqueda que usas todos los días (`vault_hybrid_search`) sigue
corriendo sobre `fts.sqlite` exactamente igual que antes — ver
[ADR-0084](../adr/0084-postgres-projection-layer.md).

---

## Lo primero: qué es una "proyección"

Tres propiedades que conviene tener claras antes de encender nada:

| Propiedad           | Qué significa en la práctica                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Derivada**        | Se construye **desde `fts.sqlite`**, que a su vez se construye desde tus notas. Nada escribe a Postgres salvo el sync. Ninguna nota nace aquí.     |
| **Desechable**      | Puedes borrar el directorio entero y no pierdes información: `vkm-pg-migrate --rebuild` la reconstruye con un comando.                             |
| **Fuera del vault** | Vive en `~/.vkm/pg/<slug>/`, **no** dentro del vault. Un datadir binario dentro de un repo que el daemon sincroniza sería una tormenta de commits. |

> **El vault manda.** Markdown en git sigue siendo la única fuente de verdad
> ([ADR-0037](../adr/0037-vault-vs-database-system-of-record.md)). Si la proyección y las
> notas discrepan, la proyección está mal y se reconstruye.

El motor por defecto es **PGlite 0.5.4**: Postgres 18 compilado a WASM que corre **dentro
del proceso Node**, sobre un directorio normal. No hay servidor que instalar, ni servicio,
ni `initdb`, ni puerto abierto al exterior. Si ya operas un Postgres de verdad, apúntale
`VKM_PG_DSN` y el mismo código corre contra él.

---

## Encenderlo

### En la instalación

```bash
npx @vkmikc/create-vkm-kit --full            # --postgres viene activo por defecto
npx @vkmikc/create-vkm-kit --full --no-postgres    # sin la capa Postgres
npx @vkmikc/create-vkm-kit --full --pg-dsn "postgres://user:pass@localhost:5432/vkm"
```

- `--postgres` (por defecto **on**) instala la capa y deja `VKM_PG=1` en la configuración
  MCP del vault.
- `--no-postgres` la deja fuera. El kit funciona igual; las tres tools de Postgres
  simplemente no se registran.
- `--pg-dsn <cadena>` usa **tu** servidor Postgres en vez del PGlite embebido. El datadir
  embebido no se crea.

### A mano, con variables de entorno

| Variable           | Para qué                                                                                | Por defecto             |
| ------------------ | --------------------------------------------------------------------------------------- | ----------------------- |
| `VKM_PG`           | `1` enciende la capa. Sin esto, todo lo demás es inerte.                                | apagado                 |
| `VKM_PG_DSN`       | Cadena de conexión a un Postgres externo. Cuando está, el servicio deja de usar PGlite. | (vacío → PGlite)        |
| `VKM_PG_DATA_ROOT` | Dónde vive el home por vault.                                                           | `<home>/.vkm/pg`        |
| `VKM_PG_PORT`      | Fija el puerto del servicio en vez de tomar uno dinámico.                               | `0` (dinámico)          |
| `VKM_PG_MODEL`     | Modelo de Ollama para el enriquecimiento de la migración.                               | `phi4-mini:3.8b-q4_K_M` |

El vault se resuelve igual que en el resto del kit: `VKM_VAULT`, si no `BASIC_MEMORY_HOME`,
si no `OBSIDIAN_MEMORY_VAULT`.

### Qué hay dentro del home por vault

`~/.vkm/pg/<slug>/`, donde `<slug>` es el nombre de la carpeta del vault más 8 caracteres
hex del SHA-256 de su ruta absoluta — así dos vaults que se llamen igual nunca colisionan:

| Archivo               | Qué es                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| `data/`               | El datadir de PGlite (no lo toques a mano; no se usa con `VKM_PG_DSN`).              |
| `service.json`        | `{ port, pid, vault, version, startedAt }` del servicio vivo.                        |
| `service.token`       | 32 bytes aleatorios en hex; el token de autenticación (modo `0600` en POSIX).        |
| `service.lock`        | `{ pid, port }`; si el proceso ya no existe, el lock es obsoleto y se puede limpiar. |
| `migration-report.md` | El informe de la última migración: qué se sincronizó, qué se sugirió, cuánto tardó.  |

---

## El servicio: un solo escritor

PGlite admite **un proceso por datadir**. Dos servidores MCP abriendo el mismo directorio lo
corrompen, así que todo pasa por un único servicio HTTP en `127.0.0.1` con puerto dinámico.
Las tools MCP y la consola son **clientes** de ese servicio, nunca abren el datadir.

- Escucha **solo en loopback**. No hay flag para exponerlo a la red.
- Toda ruta exige la cabecera `x-vkm-pg-token` con el contenido de `service.token`. La única
  excepción es `GET /api/health`. Token ausente o incorrecto →
  `401 {"error":"unauthorized"}`.
- `vault_pg_status` lo **arranca solo** si hace falta, así que en el uso normal nunca lo
  lanzas a mano.

---

## La CLI de migración, paso a paso

`vkm-pg-migrate` es lo que crea y llena la proyección la primera vez.

**1. Primera construcción.** Vuelca el índice y crea el esquema:

```bash
VKM_PG=1 vkm-pg-migrate --vault "<RUTA_AL_VAULT>"
```

Por dentro: `python -m obsidian_memory_rag json-dump-index` lee **solo `fts.sqlite`** y
emite un objeto JSON (manifiesto de todas las rutas indexadas + las filas cambiadas); el
servicio lo aplica en una transacción, borra las filas cuya ruta ya no está en el
manifiesto y avanza el cursor `cursor_mtime_ns`. Nada de ese camino lee un `.md`
directamente — solo `--enrich` lo hace, en solo lectura, para armar sus prompts.

**2. Comprobar que quedó bien.** El informe se escribe en
`~/.vkm/pg/<slug>/migration-report.md`, y el estado en vivo lo da:

```bash
curl http://127.0.0.1:<puerto>/api/health
```

**3. Ponerla al día más tarde.** El sync es incremental por `mtime_ns`, así que re-ejecutar
la migración solo toca lo que cambió. Desde un agente basta con `vault_pg_status`, que
sincroniza y responde.

**4. Reconstruir desde cero** (tras un upgrade de Postgres, o si sospechas corrupción):

```bash
vkm-pg-migrate --vault "<RUTA_AL_VAULT>" --rebuild --yes
```

Con el backend por defecto (PGlite) borra el datadir local y lo rehace desde el volcado. Con
`VKM_PG_DSN` no hay datadir local: en su lugar hace `TRUNCATE` de las tablas del contrato
(`notes`, `chunks`, `relations`, `observations`, `activity`, `suggestions`) en una sola
transacción, borra el cursor de sync y fuerza un resync completo. Es seguro por diseño: la
proyección es desechable. Dos barandillas en ambos casos: **se niega** mientras un
`pg-service` tenga la base (párale primero), y sin `--yes` te pide confirmación.

### Todos los flags

| Flag               | Para qué                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `--vault <ruta>`   | Vault a proyectar. Si falta: `VKM_VAULT` / `BASIC_MEMORY_HOME` / `OBSIDIAN_MEMORY_VAULT`. |
| `--full`           | Resync completo en vez del incremental (ignora el cursor).                                |
| `--rebuild`        | Rehace desde cero: borra el datadir (PGlite) o `TRUNCATE` + cursor (con `VKM_PG_DSN`).    |
| `--enrich [N]`     | Pase de sugerencias con LLM local sobre hasta `N` notas sin estructura (25 por defecto).  |
| `--model <nombre>` | Modelo de Ollama para `--enrich`. Gana sobre `VKM_PG_MODEL`.                              |
| `--dry-run`        | Dice qué haría; no toca nada.                                                             |
| `--yes`            | Salta la confirmación de `--rebuild`.                                                     |
| `--json`           | Resumen legible por máquina en stdout.                                                    |
| `--no-report`      | No escribe `migration-report.md`.                                                         |
| `--help`, `-h`     | Imprime la ayuda y sale (no toca la base).                                                |

Cualquier otro argumento aborta con `unknown flag: <flag>` y exit code 1 — no hay flags
silenciosamente ignorados.

### `--enrich`: sugerencias, nunca escrituras

```bash
vkm-pg-migrate --vault "<RUTA>" --enrich
vkm-pg-migrate --vault "<RUTA>" --enrich 100 --model "qwen2.5:7b"   # pase más amplio, otro modelo
```

Con `--enrich`, un modelo **local** (Ollama, `phi4-mini:3.8b-q4_K_M` por defecto) lee las
notas que **no** tienen relaciones **ni** observaciones y propone la estructura tipada que el
texto sugiere pero nadie escribió. El tope (25 notas por defecto) mantiene acotada la primera
pasada.

> ⚠️ **Doctrina: propone, no escribe.** El enriquecimiento escribe **exclusivamente** en la
> tabla `suggestions`. No toca `notes`, ni `relations`, ni `observations`, ni ningún archivo
> `.md`. Nada entra en tu grafo de conocimiento sin que tú lo aceptes — la misma regla que
> `vault_kg_suggest` ([ADR-0023](../adr/0023-structured-knowledge-graph.md)) y
> `vault_memory_report` ([ADR-0024](../adr/0024-memory-reports-and-compaction.md)).

Las sugerencias pendientes se leen así:

```bash
curl -H "x-vkm-pg-token: $(cat ~/.vkm/pg/<slug>/service.token)" \
     "http://127.0.0.1:<puerto>/api/suggestions?status=pending"
```

Si Ollama no está corriendo, `--enrich` **no rompe la migración**: la parte determinista se
completa igual, el informe registra `enrichment: skipped` con el motivo y el exit code sigue
siendo 0 ([ADR-0047](../adr/0047-ollama-structured-outputs.md)). Pasa lo mismo si un
`pg-service` tiene el datadir: el pase de enriquecimiento necesita acceso exclusivo a la base
— para el servicio y vuelve a lanzarlo si lo quieres.

---

## Las tres tools MCP

Se registran solo cuando la capa está encendida. Sus parámetros reflejan los de la API HTTP.

### `vault_pg_status`

Salud de la proyección: backend, conteo de filas, último sync. **Arranca el servicio si no
está corriendo**, así que suele ser la primera llamada de la sesión.

```jsonc
{ "name": "vault_pg_status", "arguments": {} }
```

Respuesta (abreviada):

```json
{
  "ok": true,
  "backend": "pglite",
  "pgVersion": "18.x",
  "notes": 412,
  "chunks": 3180,
  "relations": 907,
  "observations": 1544,
  "lastSyncAt": "2026-08-02T09:14:03.000Z",
  "capabilities": { "vector": true, "notify": true }
}
```

### `vault_graph_hops`

Recorrido tipado a varios saltos con SQL recursivo — la consulta que en el índice SQLite
serían N llamadas encadenadas a `vault_relations`.

```jsonc
{
  "name": "vault_graph_hops",
  "arguments": {
    "from": "PROJECTS/create-vkm-kit.md",
    "depth": 3,
    "direction": "both",
    "types": "implements,supersedes,part_of",
    "limit": 200
  }
}
```

Devuelve `nodes` (`path`, `title`) y `edges` (`source`, `type`, `target`, `depth`).
En la tool MCP `from` es **obligatorio**, `depth` va de 1 a 4 (2 por defecto), `direction` es
`out`, `in` o `both` (`both` por defecto) y `limit` va de 1 a 200 (50 por defecto). El grafo
completo se pide por la API HTTP: `GET /api/graph` sin `from` lo devuelve recortado por
`limit` (500 aristas por defecto).

### `vault_timeline`

Actividad reciente del log de sync de la proyección: qué nota se actualizó o se borró,
cuándo corrió un sync, cuándo se migró.

```jsonc
{ "name": "vault_timeline", "arguments": { "limit": 20 } }
```

Cada evento trae `id`, `at`, `kind` (`note_upsert`, `note_remove`, `sync`, `migrate`,
`suggestion`), `path` y un `detail` libre. Sin `sinceId` devuelve los **más recientes
primero**; con `sinceId` pagina hacia adelante en orden **ascendente** desde ese id. Acepta
también `scope`.

---

## Memoria por agente y por proyecto

El vault es **uno** y el índice es **uno** — lo que hay son **namespaces**
([ADR-0086](../adr/0086-scoped-memory-namespaces.md)): `PROJECTS/<proyecto>.md` para
proyectos (la convención de siempre) y una carpeta `AGENTS/` de primer nivel con una nota
por agente (`AGENTS/<nombre-agente>.md`), con las mismas estructuras — frontmatter,
relaciones tipadas y observaciones `[categoría]`. El vault inicial trae la plantilla
(`AGENTS/TEMPLATE.md`). Nada de un vault por agente: eso fragmenta la memoria, y la fuga
entre proyectos se maneja acotando el recall, no multiplicando índices
([ADR-0074](../adr/0074-cross-project-leakage.md)).

El recall gana un filtro genérico llamado **`scope`**: flag `--scope` en la CLI, parámetro
`scope` en las tools MCP que filtran por ruta (`vault_hybrid_search`, `vault_fts_search`,
`vault_observations`, `vault_timeline`) y query param `scope` en las rutas
`/api/graph`, `/api/timeline`, `/api/stats` y `/api/search` del servicio. La
semántica es un prefijo de ruta relativo estilo posix, casado en **límite de segmento**:
una ruta `P` casa con un scope `S` si `P == S`, `P == S + ".md"` o `P` empieza por
`S + "/"`. Sensible a mayúsculas. Un scope con `..`, `/` inicial, letra de unidad o
backslashes se **rechaza con error** (no con «cero resultados»). Se aplica **después** del
filtro `section` existente.

```jsonc
// Solo la nota de un proyecto
{ "name": "vault_hybrid_search", "arguments": { "query": "cursor del sync", "scope": "PROJECTS/vkm-kit" } }

// Los gotchas registrados en la memoria de un agente concreto
{ "name": "vault_observations", "arguments": { "category": "gotcha", "scope": "AGENTS/vkm-implementer" } }

// Actividad reciente de todas las memorias de agentes (vía la proyección)
{ "name": "vault_timeline", "arguments": { "limit": 20, "scope": "AGENTS" } }
```

`assemble_context` acepta además `agentName`: incluye la nota `AGENTS/<agentName>.md` en
el paquete presupuestado, igual que `project` incluye la de `PROJECTS/`.

---

## La API HTTP

Base: `http://127.0.0.1:<puerto de service.json>`. Cabecera
`x-vkm-pg-token: <contenido de service.token>` en todas menos `/api/health`.

| Método + ruta          | Para qué                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`      | Backend, versión de PG, conteos, último sync, `capabilities`, si está vigilando. **Sin token.**                    |
| `POST /api/sync`       | `{"mode":"incremental"\|"full"}` → filas sincronizadas, cursor nuevo y `tookMs`.                                   |
| `GET /api/graph`       | `from`, `depth` (1–4), `direction` (`out`/`in`/`both`), `types` (csv), `limit`, `scope` → `nodes` + `edges`.       |
| `GET /api/timeline`    | `limit` (1–1000, 50 por defecto), `sinceId`, `scope` → eventos de actividad.                                       |
| `GET /api/stats`       | `scope`. Agregados: notas por carpeta, observaciones por categoría, relaciones por tipo, tags top y chunks.        |
| `POST /api/search`     | `{"q":…,"limit":N,"mode":"fts"\|"vector","scope":…}`. **Analítica, no ranking**: el recall diario sigue en SQLite. |
| `GET /api/events`      | Stream SSE. `hello` al conectar, `activity` por cada fila nueva, comentario de heartbeat cada 25 s.                |
| `GET /api/suggestions` | `status=pending` → lo que propuso `--enrich`, sin aplicar.                                                         |

> `mode:"vector"` necesita embeddings en disco y la extensión `vector`. Si falta alguna,
> responde **HTTP 200** con `hits` vacío y un campo `error` explicando por qué — no lanza
> excepción.

Sobre el orden y el `scope` de estas rutas:

- **`/api/timeline`**: sin `sinceId` devuelve los eventos **más recientes primero**
  (`ORDER BY id DESC`); con `sinceId` cambia a **ascendente** desde ese id, que es lo que
  hace útil la paginación hacia adelante. Un timeline con `scope` descarta las filas con
  `path` nulo (`kind:"sync"`, `migrate`): un evento de todo el vault no es atribuible a un
  namespace.
- **`scope` inválido** (`..`, `/` inicial, letra de unidad, backslash) →
  `400 {"error":"invalid scope"}` en las cuatro rutas. Nunca «cero resultados».
- En `POST /api/search` el campo `scope` del body gana; `?scope=` en la URL se acepta por
  paridad con las rutas GET.

---

## Problemas típicos

### "El servicio no está corriendo"

Síntoma: una tool devuelve error de conexión, o `curl` a `/api/health` no responde.

1. Llama `vault_pg_status`: arranca el servicio solo.
2. Si insiste, mira `~/.vkm/pg/<slug>/service.lock`. Si el `pid` que contiene ya no existe,
   el lock es **obsoleto**: bórralo y reintenta.
3. Comprueba que `VKM_PG=1` esté realmente en el entorno del servidor MCP (no solo en tu
   shell) — es el interruptor general.

### 401 `unauthorized`

El token de `service.token` cambió (el servicio se reinició) o lo copiaste con un salto de
línea de más. Vuelve a leer el archivo tal cual. Recuerda que `/api/health` **no** pide
token: si esa ruta responde y las demás dan 401, el problema es el token, no el servicio.

### Node 20 y el paquete `pgvector`

El kit soporta **Node ≥ 20** y no usa el paquete npm `pgvector` (requiere Node 22). Los
vectores se escriben como literal de texto `'[f1,f2,…]'::vector`. Si ves un error pidiendo
Node 22, algo instaló `pgvector` por su cuenta: quítalo, no hace falta.

### Un upgrade mayor de Postgres invalida el datadir

PGlite trae una versión de servidor dentro. Cuando el kit salte de PG18, tu directorio
existente **no abrirá** — y no hay `pg_upgrade` aquí, por diseño. La regla es la
proyección desechable:

```bash
vkm-pg-migrate --vault "<RUTA_AL_VAULT>" --rebuild
```

`meta.pglite_version` guarda la versión con la que se creó el datadir, justo para que este
caso se detecte y se te diga en vez de fallar de forma rara.

### Con `VKM_PG_DSN`, la búsqueda vectorial dice "no disponible"

Tu Postgres no tiene la extensión `vector` y el servicio no pudo crearla. No es fatal:
`capabilities.vector` pasa a `false`, la columna `vec` se omite y **todo lo demás sigue
funcionando** (grafo, timeline, stats, FTS). Instala `pgvector` en ese servidor si la
quieres.

### El daemon de git empezó a commitear archivos raros

No debería: la proyección vive fuera del vault. Si la moviste con `VKM_PG_DATA_ROOT` a una
ruta **dentro** del vault, sácala de ahí — es exactamente el fallo que la regla
"fuera del vault" evita.

---

## Más

- Decisión y alternativas descartadas: [ADR-0084](../adr/0084-postgres-projection-layer.md).
- Lo que reemplaza (en parte): [ADR-0083](../adr/0083-memory-remaster-no-postgres.md).
- La consola que consume `/api/events` en vivo: [consola](consola.md).
- Mapa técnico del repo: [`ARCHITECTURE.md`](../../ARCHITECTURE.md).
