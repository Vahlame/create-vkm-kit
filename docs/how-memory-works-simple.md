# Cómo funciona esta memoria (explicación sencilla y completa)

Esta página es **solo palabras**: no asume que sepas qué es MCP ni FTS. Si quieres el recorrido de instalación paso a paso, ve primero a [`../GETTING_STARTED.md`](../GETTING_STARTED.md).

## El problema que resuelve

Los chats con la IA **no guardan** de forma fiable lo que acordaste en la sesión anterior. Cada conversación empieza “en blanco” respecto a tu vida, tu equipo o tu proyecto, salvo lo que lleves pegado en el prompt.

Esta memoria **no vive dentro del modelo**. Vive en **archivos de texto** (Markdown) en **tu ordenador**, en una carpeta que tú controlas. Así puedes leerlos, editarlos, buscarlos y versionarlos con **git** como cualquier otro proyecto.

## La idea en una frase

Tienes una **carpeta de notas** (el “vault”). Un **programa pequeño** (el servidor MCP, por defecto `basic-memory`) se conecta al editor y le da a la IA **herramientas** para leer y escribir esas notas. Opcionalmente pegas **reglas de texto** en Cursor (“User Rules”) para que la IA **use** esas herramientas con un orden sensato (por ejemplo: primero `START_HERE.md`, luego `MEMORY.md`, luego el proyecto activo).

**Sincronización y MCP “siempre arriba” (v3, guía pública):** por defecto el IDE usa **`basic-memory` por stdio** (no hace falta un segundo proceso). Para llevar el vault a **git** con poco esfuerzo se documenta **`obsidian-memoryd watch`** o **comandos git a mano**; el HTTP persistente y las tareas de Windows son **opcionales** y las define quien instala — el kit **ya no publica** `.ps1`/`.vbs` en el repo. Si venías del modelo v2 con scripts del kit, lee el capítulo **[`docs/migration/v2-to-v3-script-free-kit.md`](./migration/v2-to-v3-script-free-kit.md)**.

## Las tres piezas (y por qué las tres)

### 1. El vault (carpeta + Markdown + git)

Es una carpeta con archivos como:

- `START_HERE.md`: índice corto; “por dónde empezar”.
- `MEMORY.md`: cosas que quieres que la IA recuerde **en general** (preferencias, lecciones que aplican a muchos proyectos).
- `PROJECTS/algo.md`: contexto **de un proyecto concreto** (nombre parecido a la carpeta del repo en el que trabajas).
- `SESSION_LOG.md`: línea de tiempo breve de “qué pasó hoy” (decisiones, cierres de tarea).

**Por qué git:** puedes ver historial (`git log`), comparar versiones y tener un remoto (GitHub privado) para otro PC o backup. El repo **público** que estás leyendo no es tu vault: tu vault es **tuyo** y suele ser **privado**.

### 2. El MCP (puente entre el IDE y la carpeta)

**MCP** (“Model Context Protocol”) es el mecanismo por el cual Cursor (u otro cliente) lanza un proceso y le pide operaciones: leer nota, escribir nota, buscar, etc.

En v2 el servidor por defecto es **`basic-memory`**, arrancado con `uvx basic-memory mcp`. La variable **`BASIC_MEMORY_HOME`** le dice **qué carpeta** es el vault. Sin eso, la IA no tiene **a dónde** apuntar.

**Importante:** el MCP no “piensa”. Solo **abre, guarda y busca archivos** según las herramientas que expone. El modelo sigue siendo el que decide qué pedir; las User Rules ayudan a que no se salte pasos.

### 3. Las User Rules (solo en Cursor; texto fijo)

Son un texto que pegas en la configuración de Cursor. **No** sustituyen al MCP: si no hay MCP, las reglas no pueden leer el disco por arte de magia.

Sirven para dos cosas:

1. **Ritmo de lectura:** “empieza por START_HERE, luego MEMORY, luego PROJECTS del repo actual”.
2. **Higiene:** “no guardes secretos”, “anota cierres en SESSION_LOG”, “si no hay MCP dilo”.

Bloque listo para copiar: [`cursor-memory-setup.md`](./cursor-memory-setup.md#paso-3-user-rules-pegar-en-cursor).

## Qué pasa cuando chateas (flujo mental)

1. Abres un proyecto en Cursor con el MCP bien configurado.
2. El modelo ve las **herramientas** (read/write/search de notas).
3. Si sigue tus User Rules, **lee** primero las notas de contexto en lugar de inventar.
4. Cuando toma decisiones útiles, puede **escribir** en `PROJECTS/...` o `SESSION_LOG.md`.
5. Tú haces `git commit` / push cuando quieras (o un daemon opcional te ayuda a sincronizar).

Nada de esto envía tus notas al modelo “para siempre” en un servidor del proveedor del LLM: lo que persiste es **lo que escribes en archivos** y lo que subes a **tu** remoto si lo configuras.

## Opcional: búsqueda muy rápida en vaults enormes (`obsidian-memory-rag` + híbrido)

`basic-memory` ya puede buscar. Si el vault es **muy grande**, un índice **SQLite FTS5** en tu máquina acelera búsquedas tipo “palabras clave en todo el cuerpo”. Eso es el paquete **`obsidian-memory-rag`**. El **MCP híbrido** expone en el IDE herramientas para **indexar** y **buscar** contra ese índice.

No es obligatorio para empezar. Es una capa de **comodidad y rendimiento**, no el núcleo del sistema.

## Qué **no** es (para no confundirse)

- **No** es lo mismo que los avisos **`memory://...`** de Cursor: eso es memoria nativa / virtual del IDE; este flujo usa **archivos** del vault vía MCP.
- **No** es un reemplazo automático de Obsidian: puedes usar Obsidian u otro editor; el vault son archivos.
- **No** es “memoria en la nube del modelo”: la persistencia útil está en **tus archivos** y tu **git**.
- **No** garantiza que la IA siempre obedezca: las reglas y el flujo mejoran el comportamiento, pero el modelo puede equivocarse; por eso el vault es revisable por humanos.

## Siguiente paso

Instalación ordenada: [`../GETTING_STARTED.md`](../GETTING_STARTED.md).

## English

Same explanation: [`how-memory-works-simple.en.md`](./how-memory-works-simple.en.md).
