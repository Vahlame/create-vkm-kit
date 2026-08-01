<p align="center">
  <img src="docs/assets/hero.svg" alt="Tu agente habla con servidores MCP, que leen y escriben notas Markdown en tu vault git; un daemon opcional sincroniza con un remoto; debajo, la suite de eficiencia vkm-kit: token-saver, vkm-doctor, vkm-spec, skills y obscura-web" width="840">
</p>

<h1 align="center">🧠 Convierte cualquier IA en un asistente con memoria permanente</h1>
<h3 align="center">Turn any AI into an assistant with permanent memory</h3>

<p align="center">
  <a href="./LICENSE.md"><img src="https://img.shields.io/badge/licencia-MIT--derivada_%2B_atribuci%C3%B3n_(no_OSI)-blue.svg" alt="Licencia"></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/release-v5.1.0-orange.svg" alt="Release"></a>
  <a href="https://github.com/Vahlame/create-vkm-kit/actions/workflows/ci.yml"><img src="https://github.com/Vahlame/create-vkm-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@vkmikc/create-vkm-kit"><img src="https://img.shields.io/npm/v/%40vkmikc%2Fcreate-vkm-kit?label=npm&color=cb3837" alt="npm"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-43853d.svg" alt="Node ≥ 20">
  <img src="https://img.shields.io/badge/plataforma-Windows%20%7C%20macOS%20%7C%20Linux-555.svg" alt="Multiplataforma">
</p>

<p align="center">
  <b>📖 Léelo en · Read this in:</b>&nbsp;
  <a href="README.md">🇪🇸 Español</a>&nbsp;·&nbsp;
  <a href="README.en.md">🇬🇧 English</a>
  &nbsp;|&nbsp;
  <b>Docs:</b>&nbsp;
  <a href="docs/es/README.md">🇪🇸 Español</a>&nbsp;·&nbsp;
  <a href="docs/en/README.md">🇬🇧 English</a>
</p>

---

Tu agente olvida todo al cerrar el chat. Este kit le da una memoria que **sobrevive entre
sesiones**: una carpeta de notas **Markdown en tu propio repo git** que el modelo lee y escribe por
**MCP**. Sin nube, sin cuenta, sin lock-in — si mañana borras el kit, tus notas siguen ahí y las
abre cualquier editor de texto.

---

## Empieza en 5 minutos

**1.** Un comando conecta tu editor a un vault (lo crea si no existe, fusiona tu `mcp.json` sin
romper otras entradas, hace backup):

```bash
npx @vkmikc/create-vkm-kit -y
```

**2.** **Reinicia tu editor.** Los servidores MCP cargan al arrancar; ningún agente puede
cargarlos en caliente, ni el que acabó de instalarlos.

**3.** En un chat nuevo, pídele esto:

> _«Lee `START_HERE.md` de mi vault y dime qué contiene.»_

Si te responde con el contenido, ya tienes memoria persistente. **Eso es todo lo que necesitas
para empezar** — de aquí para abajo es opcional.

<details>
<summary><b>⚡ Quiero todo el potencial en un solo comando (<code>--full</code>)</b></summary>

<br>

Enfocado **primero en Codex y Claude Code**, con **todas las funciones activas por defecto**:
registra el MCP en ambos, activa la búsqueda híbrida (BM25, semántica y grafo), el **grafo de
conocimiento** (relaciones tipadas y observaciones), los **memory reports**, la **aceleración
sqlite-vec**, la **seguridad multi-escritor** (etag, `ifMatch` y lock de escritura, ADR-0037) y el
**bucle de memoria evolutiva** (recall de fallos, boost por uso, propuestas de `memory-reflect`,
ADR-0038), instala el backend Python, construye el índice e instala las reglas — sin preguntas.
Córrelo desde un clon del kit (o pásale `--repo-root <clon>`):

```bash
npx @vkmikc/create-vkm-kit --full          # = --ide codex,claude --with-hybrid --semantic --vec --build-index --install-backend --rules --obscura
```

Si no hay clon a mano, `--full` **no aborta**: cae a `basic-memory` (sin híbrido) y avisa.

</details>

<details>
<summary><b>🤖 Prefiero que un agente lo instale por mí</b></summary>

<br>

Dile _«linkea el repo e instálalo con todas sus herramientas y capacidades»_: clona y ejecuta
`npm install` + `npm run setup` — preflight de dependencias → instalación `--full` (memoria
híbrida + token-saver + vkm-doctor + vkm-spec + skills) → verificación → aviso de reinicio.
Paso a paso: [🇪🇸 instalar con agente](docs/es/instalar-con-agente.md) ·
[🇬🇧 install with an agent](docs/en/install-with-agent.md).

</details>

<details>
<summary><b>🔧 Otras formas de instalar, y cómo mantenerlo al día</b></summary>

<br>

```bash
npx @vkmikc/create-vkm-kit                 # asistente interactivo (pre-marca Codex + Claude)
npx @vkmikc/create-vkm-kit "<RUTA>" -y     # sin preguntas, en la ruta que elijas
```

**Mantenerlo al día (ADR-0061).** `--check-update` compara tu versión con la de npm y dice qué
plantillas de skills/subagentes cambiaron — **no escribe nada y nunca falla** (sin red imprime
"skipped" y sale 0). `--update` aplica ese plan: instala lo que falta o lo que cambió el kit, y
**deja intacto cualquier archivo que hayas editado tú** (lo lista por nombre; `--force` lo pisa y
**descarta tus cambios**, `--dry-run` previsualiza sin escribir).

**Claude Code / Codex en PC nuevo.** `--full` ya registra el MCP vía `claude mcp add` /
`codex mcp add` y construye el índice en el mismo comando. Para Claude Code además deja el vault
como **única** memoria: apaga la auto-memoria nativa (`autoMemoryEnabled:false`), instala un hook
`SessionStart` del vault (ADR-0029), dos hooks de aplicación determinista — bloqueo de escritura a
la memoria nativa + recordatorio de cierre — para que funcione con cualquier modelo (ADR-0030), y
un "effort advisor" que calibra coste sin interrumpir jamás: persiste el nivel de esfuerzo que el
trabajo pide para la próxima sesión y te avisa una sola vez fuera del contexto del modelo (ADR-0081). ¿Solo lo básico? usa `--ide codex,claude`. Guía completa:
[🇪🇸 instalar en PC nueva](docs/es/instalar-pc-nueva.md) ·
[🇬🇧 fresh-PC install](docs/en/install-fresh-pc.md).

El nombre npm antiguo (`@vkmikc/create-obsidian-memory`) está **deprecado y congelado en el kit v3
(3.15.0)**: no reenvía al nuevo, así que si lo tienes fijado en un script, cámbialo a
`@vkmikc/create-vkm-kit`.

</details>

Guía completa paso a paso, con verificación: [🇪🇸 **instalación**](docs/es/instalacion.md) ·
[🇬🇧 **install**](docs/en/install.md). Cómo fluye la información:
[🇪🇸 **cómo funciona**](docs/es/como-funciona.md) · [🇬🇧 **how it works**](docs/en/how-it-works.md).

---

## Qué ganas

- 🧠 **Deja de repetir contexto.** Las decisiones, preferencias y lecciones de ayer siguen ahí hoy,
  en cualquier chat y con cualquier modelo.
- 💸 **Gasta menos tokens haciéndolo.** El recall devuelve la **sección** que responde, no la nota
  entera: **−62 %** de tokens medidos contra leer notas completas, con gate en CI que rompe el build
  si regresa.
- 🔒 **Es tuyo y es legible.** Markdown plano en tu repo git. Ninguna nota sale de tu máquina, y el
  día que dejes el kit te quedas con todas.

<details>
<summary><b>🧩 Qué hay dentro (no necesitas conocerlo para usarlo)</b></summary>

<br>

Lo **único obligatorio** es el servidor MCP. Todo lo demás abajo es opcional y se activa cuando lo
pides — por eso la instalación es un comando aunque la lista sea larga.

| Pieza · Piece                                                    | Lenguaje | Rol                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/create-vkm-kit/`](packages/create-vkm-kit/)           | Node     | Instalador `npx` **(npm)**: memoria + token-saver + telemetría + skills en un comando.                                                                                                                                                                                                                                                                                            |
| [`packages/obsidian-memory-mcp/`](packages/obsidian-memory-mcp/) | Node     | MCP "híbrido" **(privado; corre desde el clon)**: tools del vault + búsqueda léxica/semántica.                                                                                                                                                                                                                                                                                    |
| [`packages/obscura-web/`](packages/obscura-web/)                 | Node     | MCP de web sigilosa **(opt-in `--obscura`; corre desde el clon)**: `obscura_fetch` + `obscura_search` (SearXNG → SERP multi-motor → fallback nativo) + `obscura_research` (crawl profundo y rankeo BM25 100% local, cero tokens extra — ADR-0054) + `obscura_research_start` (jobs de investigación en segundo plano, hasta 30 min — ADR-0060) vía el navegador headless obscura. |
| [`packages/obsidian-memory-rag/`](packages/obsidian-memory-rag/) | Python   | Motor de búsqueda FTS5/BM25 + vectorial **(`pip install -e` desde el código)**; cero dependencias por defecto.                                                                                                                                                                                                                                                                    |
| [`packages/vkm-doctor/`](packages/vkm-doctor/)                   | Node     | Sink OTLP local + doctor de uso/caché: tokens, coste y salud de la caché, todo en tu máquina.                                                                                                                                                                                                                                                                                     |
| [`packages/vkm-spec/`](packages/vkm-spec/)                       | Node     | De idea a spec XML anclada al vault (GUI en `127.0.0.1:4923`; Ollama `phi4-mini` opcional, fallback determinista).                                                                                                                                                                                                                                                                |
| [`packages/vkm-downloads/`](packages/vkm-downloads/)             | Node     | MCP de descargas guiadas **(opt-in `--downloads`; adrede fuera de `--full` — escribe a disco; corre desde el clon)**: `download_resolve` (solo metadatos) → confirmar → descargar a `~/Downloads/vkm-kit/`; jobs en segundo plano con resume, sets y mirror más rápido (ADR-0058/0059).                                                                                           |
| [`cmd/obsidian-memoryd/`](cmd/obsidian-memoryd/)                 | Go       | Daemon opcional: vigila el vault y sincroniza git.                                                                                                                                                                                                                                                                                                                                |

> ℹ️ **obscura** es software de terceros bajo licencia **Apache-2.0** ([h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura)). El kit **lo descarga** del release oficial y lo verifica por SHA-256 — **no lo empaqueta ni redistribuye**. Búsqueda estructurada vía **SearXNG on-demand** (se levanta solo al buscar, se apaga al terminar; monitor de escritorio opcional) — [ADR-0052](docs/adr/0052-searxng-on-demand-lifecycle.md).
>
> 🧭 **Skills que instala el kit** (además de los paquetes): **`/vkm-discipline`** — disciplina de ejecución cross-dominio (infiere la intención real, entrega más que lo literal, con evidencia ejecutada) que sube el rendimiento de **cualquier modelo**, Haiku a Opus — **`/vkm-spec`** (idea → spec anclada al vault) — **`/vkm-design`** (diseño profesional anti-genérico para cualquier UI/medio: dirección antes de píxeles, checks computados, librerías reales verificadas online, loop visual) — **`/vkm-research`** (consolida un banco `RESEARCH/<tema>` en un `summary.md` con wikilinks y supersesión) — **`/vkm-verify`** (demuestra que un check verde realmente corrió, cubrió tu cambio y sabe fallar: control negativo con `prove-it.mjs`) — **`/vkm-intake`** (lee bien la tarea antes de ejecutar: objetivo/entregable/no-hacer en 3 líneas, una sola pregunta cerrada si hay ambigüedad, inventario de lo que muestran las imágenes, contexto mínimo) — y **`/vkm-ui-judge`** (juicio visual **medido** de cualquier GUI: web con audit Playwright en 3 viewports × claro/oscuro y contraste WCAG computado; Flutter con los gates de accesibilidad de `flutter_test`; Qt/.NET/Python/Java con loop de screenshots reales — arregla con evidencia antes/después en vez de "pensar mirando"). Cuál usar en cada situación: [guía de skills](docs/es/guia-de-skills.md). Detalle: [ADR-0049](docs/adr/0049-discipline-doctrine-three-channels.md), [ADR-0053](docs/adr/0053-vkm-design-skill.md) y [ADR-0056](docs/adr/0056-research-knowledge-bank.md).

Mapa técnico completo y diagramas de flujo: [`ARCHITECTURE.md`](ARCHITECTURE.md). El _porqué_ de
cada decisión: [`docs/adr/`](docs/adr/). Cada pieza y cada conexión, con diagramas de secuencia por
operación: [🇪🇸 arquitectura a fondo](docs/es/arquitectura-a-fondo.md) ·
[🇬🇧 architecture deep dive](docs/en/architecture-deep-dive.md).

</details>

<details>
<summary><b>📊 Los números, y el gate de CI que los sostiene</b></summary>

<br>

**Economía de tokens, medida y con candado en CI · Token economy, measured and CI-locked:** recall
passage-first **−62%** vs leer notas enteras (coste real del wire, k=3), `assemble_context`
**−68% de tokens de wire (mediana)** vs encadenar búsquedas (gate CI 0.60/0.90), token-saver
**≥30% de compactación con cero pérdida de diagnóstico** (gate CI) y **≈ −1.300 tokens/sesión**
de renta fija (schemas + hook + bloque de reglas) — cada número tiene un gate que **rompe el build**
si regresa (corpus fijo etiquetado + embedder determinista: pisos de regresión reproducibles,
no un leaderboard). Detalle · detail: [🇪🇸 cómo funciona](docs/es/como-funciona.md) ·
[🇬🇧 how it works](docs/en/how-it-works.md) · [`evals/`](evals/).

<p align="center">
  <img src="docs/assets/bench-results.svg" alt="Dumbbell chart: puntuación con skill vs stock por bench y modelo — research-bench, design-bench y discipline-bench suben con la skill en Sonnet y Opus; Haiku plano en design" width="880">
</p>

**Y con modelos vivos (ronda 2026-07-21, Haiku 4.5 + Sonnet 5, datos crudos commiteados):**
las 4 skills evaluadas rutean con **100% de acierto y 0% de falsos positivos** (104 casos ES+EN; `/vkm-verify` es posterior al bench y todavía no está medida);
el A/B pre-registrado del token-saver dio **delta 0.0 de calidad** con el log **~81% más
pequeño** (veredicto: mantener — y la regla dice que un mecanismo que degrade **se elimina**);
`/vkm-discipline` sube a Haiku **de 47.0 a 91.7 (+44.7)** en la tarea subespecificada sin
tocar a Sonnet. Además un **e2e smoke** en CI prueba el stack entero por stdio real
(instalar → indexar → buscar → escribir → re-buscar) y la latencia por query está gateada
(p95 medido ~3 ms). Todo reproducible: [`evals/skills-triggering/`](evals/skills-triggering/) ·
[`evals/token-quality-ab/`](evals/token-quality-ab/) · [`evals/discipline-bench/`](evals/discipline-bench/).

</details>

---

## Más · More

- **Después de instalar · After installing:** [🇪🇸 guía de uso + situacional](docs/es/guia-de-uso.md) · [🇬🇧 usage + situational guide](docs/en/usage.md).
- **¿Vienes de 4.x? · Coming from 4.x?** [🇪🇸 Migración a 5.0](docs/es/migracion-5.0.md) · [🇬🇧 5.0 migration](docs/en/migration-5.0.md) — en Windows, cierra todas las sesiones del editor **antes** de ejecutar el instalador.
- **¿Vienes de 3.x? · Coming from 3.x?** [🇪🇸 Migración a 4.0](docs/es/migracion-4.0.md) · [🇬🇧 4.0 migration](docs/en/migration-4.0.md).
- **Seguridad / confianza:** [`SECURITY.md`](SECURITY.md) — el vault es **datos**, no instrucciones.
- **PC nuevo · Fresh PC (Claude Code):** [🇪🇸 instalar en PC nueva](docs/es/instalar-pc-nueva.md) · [🇬🇧 fresh-PC install](docs/en/install-fresh-pc.md).
- **Comparación con alternativas:** [FAQ 🇪🇸](docs/es/faq.md) · [FAQ 🇬🇧](docs/en/faq.md).
- **Contribuir:** [`CONTRIBUTING.md`](CONTRIBUTING.md) · **Para agentes que tocan este repo:** [`AGENTS.md`](AGENTS.md).
- **Versionado · Versioning:** SemVer sobre el contrato instalado; majors congelados salvo ruptura inevitable — [política](CONTRIBUTING.md#versioning-policy-post-4x).
- **Privacidad / telemetría:** [`docs/en/observability.md`](docs/en/observability.md).

## Licencia · License

Libre uso con atribución visible obligatoria (base MIT) — ver [`LICENSE.md`](LICENSE.md). **No es
MIT estándar ni una licencia aprobada por la OSI**: la cláusula de atribución visible obligatoria
queda fuera de la definición open source de la OSI. Por eso cada `package.json` la declara como
`"license": "SEE LICENSE IN LICENSE.md"` — ningún escáner debe clasificarla como MIT.
