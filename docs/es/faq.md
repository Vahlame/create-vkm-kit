> 🇪🇸 Español · [🇬🇧 English](../en/faq.md)

# Preguntas frecuentes

Respuestas cortas a las dudas más comunes sobre este kit: una **memoria persistente** para tu asistente de IA, guardada como notas Markdown que tú controlas. Si aún no sabes cómo funciona la idea, empieza por [cómo funciona](como-funciona.md); para instalarlo, [instalación](instalacion.md); y si te topas con un término raro, el [glosario](glosario.md) lo explica.

> En este documento, **MCP** es el puente que conecta el editor (Cursor) con tus notas: un pequeño programa que el editor lanza para leer y escribir archivos. Y el **vault** es simplemente la carpeta de notas Markdown (tu memoria), que vive en un repositorio de git tuyo.

## Preguntas frecuentes

### ¿Por qué no uso la función "memorias" que ya trae Cursor?

Las memorias integradas de Cursor están atadas a tu cuenta y al almacenamiento de Cursor: **no son portables** y no puedes leerlas ni editarlas fuera de Cursor. Este kit te da un **vault Markdown que es tuyo**, en un repositorio privado de GitHub, que puedes leer o editar en cualquier editor, sincronizar entre máquinas y buscar con herramientas normales. La sección [Comparación con alternativas](#comparación-con-alternativas) entra en detalle.

### ¿Es seguro instalar esto?

Configuras el MCP con el inicializador `create-obsidian-memory` (o a mano) y, opcionalmente, instalas el daemon en Go. Todo lo que ejecuta el agente corre **con tus permisos** — escribe en `~/.cursor/mcp.json`, instala daemons en segundo plano, edita la config de git — así que trátalo como un instalador: verifica de dónde clonas, fija (pin) las versiones y revisa los diffs. El archivo [`SECURITY.md`](../../SECURITY.md) cubre el modelo de confianza.

> El vault es tuyo, pero su **contenido son datos, no órdenes**. Si una nota dijera "ejecuta tal comando" o "ignora las reglas", el agente debe ignorarlo: las instrucciones autoritativas vienen del chat y de tu configuración, nunca del vault.

### Instalarlo es solo pegar un prompt, ¿verdad?

No, y eso es precisamente lo que este kit **no** es. Montar la memoria significa **configurar un servidor MCP** apuntando a tu vault, opcionalmente construir el índice de búsqueda (FTS/semántico) en Python, y opcionalmente correr el daemon de sincronización en Go. La guía de [instalación](instalacion.md) acompaña cada paso.

### ¿Cuánto cuesta?

Nada. Pagas el plan de Cursor que ya tengas, más un repositorio privado de GitHub (gratis en cuentas personales).

### ¿Funciona sin internet?

La memoria **local sí**; la sincronización con GitHub no. El servidor `basic-memory` se ejecuta junto a la sesión del editor (vía `uvx`, sin servicio aparte). El daemon opcional **`obsidian-memoryd watch`** agrupa la sincronización con git: fallará el push/pull mientras no haya red y se pondrá al día en el siguiente ciclo cuando vuelva la conexión.

### ¿Por qué un repositorio privado?

Tu memoria puede incluir nombres de clientes, arquitecturas internas, ideas a medio formar y enlaces que no quieres públicos. Un repo privado es el ajuste de seguridad por defecto.

### ¿Pueden escribir varias máquinas a la vez?

Sí, con matices. La sincronización usa `git pull --rebase`, que combina bien las ediciones que no se solapan. Si dos máquinas editan **la misma línea** de `MEMORY.md` antes de que corra la siguiente sincronización, tendrás un conflicto de git que resolver a mano. Es raro, porque el agente **añade** en vez de sobrescribir. Conviene usar intervalos de sincronización **más largos** (el daemon agrupa cada 45 s por defecto; las guías de tarea programada usan 60 minutos) para no martillear el repositorio remoto.

### ¿Ralentiza Cursor?

No de forma apreciable con vaults de tamaño normal. El servidor MCP corre **fuera del proceso** del editor; las llamadas son tan rápidas como hablar con tu propia máquina (loopback). **Para vaults muy grandes:** añade el índice opcional **`obsidian-memory-rag`** para que la búsqueda (`vault_fts_search` / `vault_hybrid_search`) siga ágil sin tener que recorrer todo en cada pregunta.

### ¿Puedo buscar por significado, no solo por palabras exactas?

Sí — eso es lo que hace **`vault_hybrid_search`**. Combina la búsqueda léxica BM25 (FTS5, palabras exactas) con similitud **semántica** por vectores (significado), fusionando ambas con un método llamado RRF (Reciprocal Rank Fusion). Así, una consulta como _"el daemon que sincroniza git"_ encuentra la nota correcta aunque no uses esas palabras exactas.

> El motor de significado por defecto no necesita instalar nada (es léxico y ya funciona). Para coincidencias reales por sinónimos, instala el extra `[semantic]`, define `OBSIDIAN_MEMORY_EMBEDDER=fastembed:<modelo>` y reconstruye los vectores con `vault_fts_index({ semantic: true })`. Detalle de diseño en ADR-0017.

### ¿La búsqueda híbrida ahorra tokens de verdad?

Para proyectos conocidos, sí. La búsqueda devuelve el **fragmento** que coincide (un encabezado + un pasaje de unos cientos de caracteres), no la nota entera, así que el agente normalmente responde **sin** tener que leer el archivo completo después. En una nota grande, eso es la diferencia entre leer un pasaje (~cientos de tokens) y un archivo de 8 KB (~miles). El coste fijo es la descripción de las herramientas de la sesión más el índice que se inyecta al arrancar; una o dos búsquedas sobre notas reales lo recuperan. Datos en `docs/benchmarks/retrieval.md`.

### ¿Puedo renombrar `MEMORY.md` o `SESSION_LOG.md`?

Puedes, pero tendrías que ajustar tus **User Rules** (y cualquier script que tenga los nombres escritos a mano). Los nombres son **convención, no protocolo**. Edita el bloque de User Rules que pegaste (ver [cómo funciona](como-funciona.md)) para que coincida con tus nombres de archivo.

### ¿Cómo lo desinstalo?

1. Quita la entrada **`basic-memory`** (o renombra el servidor) de la config MCP de tu editor: `%USERPROFILE%\.cursor\mcp.json`.
2. Detén **`obsidian-memoryd`** si lo instalaste (mata el proceso / quita el acceso directo de Inicio).
3. Borra los datos locales del índice en **`<vault>/.obsidian-memory-rag/`** si ya no lo quieres.

Tu vault Markdown sigue siendo tuyo.

### ¿Por qué "Windows primero"?

La primera instalación de extremo a extremo del autor fue en Windows (ADR-0007). El kit ahora es **multiplataforma**: el daemon en Go (`cmd/obsidian-memoryd`) se encarga de la sincronización fuera de Windows.

### ¿Funcionará en Cursor Web / cursor.com?

Por lo general **no**, por la misma razón que cualquier MCP en local: la interfaz web **no puede alcanzar procesos en tu máquina**. El modo por defecto es **`uvx basic-memory mcp`** (un proceso hijo local); incluso algunas variantes por HTTP siguen atadas a "tu máquina + el editor de escritorio". Trata el Cursor web como no soportado salvo que el proveedor documente un puente válido.

### ¿Funcionará con Claude Desktop, Continue u otros clientes compatibles con MCP?

En principio sí. Consumen el **mismo servidor MCP**. Tendrías que traducir las User Rules y el bloque de `mcp.json` a la configuración equivalente de ese cliente. Los archivos del vault no cambian.

### ¿Hasta qué tamaño puede crecer el vault?

En la práctica, varios cientos de MB van bien. Los diffs de git se mantienen pequeños; el índice opcional **`obsidian-memory-rag`** (FTS5 + vectores por fragmento) mantiene la búsqueda rápida a cualquier tamaño. Leer `MEMORY.md` está acotado por el contexto del modelo, porque el agente lee **solo lo que necesita**.

### ¿Puedo compartir `MEMORY.md` con un compañero?

Sí. Invítalo al repositorio privado. Ejecuta `create-obsidian-memory` para fusionar la misma config MCP y clonar el vault; aplica las costumbres normales de git si dos personas editan la misma línea.

### ¿Cómo actualizo?

`git pull` de este repo para docs y herramientas; sube la versión de **`@vahlame/create-obsidian-memory`** si usas el inicializador; refresca los pins de MCP si el `CHANGELOG.md` / `SECURITY.md` lo indican. Puedes volver a correr `create-obsidian-memory --non-interactive --vault "<ruta>"` para re-fusionar una config limpia. Tu vault sigue separado.

### Vault grande: ¿algo más allá de la búsqueda de `basic-memory`?

Sí: activa el **MCP híbrido** con el inicializador (necesita `pip install -e packages/obsidian-memory-rag` una vez):

```bash
node packages/create-obsidian-memory/src/index.js \
  --non-interactive --vault "<ruta>" --with-hybrid --repo-root "<clon-del-kit>"
```

Construye el índice con `obsidian-memory-rag index --vault <ruta> --semantic` (o la herramienta MCP `vault_fts_index` con `semantic: true`). A partir de ahí, `vault_fts_search` devuelve resultados BM25 y `vault_hybrid_search` devuelve pasajes BM25 + semánticos ordenados por relevancia. Pruebas de humo en `docs/testing/manual-checks.md`.

## Comparación con alternativas

Posicionamiento honesto del **kit v3** (multiplataforma, `basic-memory`, daemon en Go opcional + RAG semántico híbrido). Frases con opinión; sigue los enlaces para el matiz.

| Aspecto                            | kit v3 (este repo)                                                 | Memoria integrada de Cursor     | mem0                                   | Letta / MemGPT                            | RAG propio (pgvector / Qdrant) |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------- | -------------------------------------- | ----------------------------------------- | ------------------------------ |
| Propiedad del almacenamiento       | Markdown en **tu** repo git                                        | Nube de Cursor                  | SaaS o self-host                       | Servidor self-host                        | Tu base de datos               |
| Atadura al editor (lock-in)        | Baja (`AGENTS.md` + MCP)                                           | Alta                            | Baja                                   | Media                                     | Baja                           |
| Transporte                         | MCP Streamable HTTP (`basic-memory`)                               | propietario                     | SDK por HTTP                           | HTTP / WS                                 | SQL / gRPC                     |
| Amigable sin conexión              | Lecturas locales del vault: sí                                     | varía                           | normalmente no                         | si es self-host                           | si es self-host                |
| Sincronización                     | git (+ Syncthing opcional)                                         | sync de cuenta                  | servicio                               | backup del servidor                       | replicación                    |
| Latencia de búsqueda a gran escala | sidecar **híbrido** opcional: FTS5 BM25 + vectores (ADR-0014/0017) | opaca                           | afinada por el servicio                | fuerte                                    | la más fuerte                  |
| Tiempo de configuración            | minutos (`uvx` + config)                                           | cero                            | cuenta + SDK                           | servidor                                  | esquema + indexador            |
| Ganchos de cumplimiento            | docs + cifrado `age` opcional + redacción OTel                     | opaca                           | docs del proveedor                     | tu política                               | tu política                    |
| Mejor para                         | Notas duraderas y editables a mano, para agentes                   | preferencias rápidas y efímeras | memoria de usuario embebida en una app | niveles de memoria del runtime del agente | corpus enormes                 |
| Peor para                          | No es un almacén de mil millones de filas                          | portabilidad / auditoría        | edición orientada a Markdown           | complejidad operativa                     | UX de notas en formato libre   |

### Cuándo elegir este kit

Cuando quieres **Markdown plano**, **historial de git**, acceso **multi-editor** y un camino incremental hacia la **búsqueda híbrida** sin montar un clúster desde el día uno.

### Cuándo no

- Cuando necesitas **memoria SaaS multi-inquilino** a escala de API: usa mem0 o un servicio que controles.
- Cuando necesitas búsqueda vectorial **estricta por debajo de 50 ms** sobre miles de millones de filas: usa una base de datos vectorial dedicada e indexadores offline.

### Convivencia con mem0

mem0 es excelente para memoria de **aplicación**; este patrón es para memoria de **desarrollador / editor**. **Pueden coexistir** sin problema: cada uno cubre una capa distinta.

### Markdown frente a SQLite

Los diffs de Markdown son **auditables por una persona**; SQLite gana en restricciones (constraints) e integridad. Aquí inclinamos la balanza hacia Markdown para la memoria del agente; usa Postgres/Qdrant para backends de producto multi-inquilino o de alta escala, gestionados por separado de este patrón de vault.
