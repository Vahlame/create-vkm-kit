<p align="center">
  <img src="docs/assets/hero.svg" alt="Tu agente habla con servidores MCP, que leen y escriben notas Markdown en tu vault git; un daemon opcional sincroniza con un remoto; debajo, la suite de eficiencia vkm-kit: token-saver, vkm-doctor, vkm-spec, skills y obscura-web" width="840">
</p>

<h1 align="center">🧠 Memoria persistente para tu agente de IA</h1>
<h3 align="center">Persistent memory for your AI agent</h3>

<p align="center">
  <em>Tus notas en Markdown + git. El modelo las lee y escribe vía MCP. Todo local, todo tuyo.</em><br>
  <em>Your notes in Markdown + git. The model reads & writes them via MCP. All local, all yours.</em>
</p>

<p align="center">
  <a href="./LICENSE.md"><img src="https://img.shields.io/badge/licencia-MIT--derivada_%2B_atribuci%C3%B3n_(no_OSI)-blue.svg" alt="Licencia"></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/release-v4.3.0-orange.svg" alt="Release"></a>
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

## ¿Qué es esto? · What is this?

🇪🇸 **vkm-kit**: un **kit multiplataforma** que le da a la IA (Cursor, Claude Code…) una **memoria que
sobrevive entre chats**: una carpeta de notas Markdown bajo git que el agente lee y escribe a
través de **MCP** (el puente entre el editor y tus archivos). Sin servicio en la nube. La pieza
obligatoria es solo el servidor MCP; lo demás (búsqueda semántica, daemon de sync) es opcional.

🇬🇧 **vkm-kit**: a **cross-platform kit** that gives your AI (Cursor, Claude Code…) **memory that survives
across chats**: a folder of Markdown notes under git that the agent reads and writes through
**MCP** (the bridge between the editor and your files). No cloud service. The only required piece
is the MCP server; everything else (semantic search, sync daemon) is optional.

> ¿Cómo fluye la información? El diagrama de arriba lo resume; el detalle visual está en
> [**Cómo funciona**](docs/es/como-funciona.md) · [**How it works**](docs/en/how-it-works.md).

<p align="center">
  🧠 <b>Memoria híbrida</b> BM25 + semántica + grafo&ensp;·&ensp;💸 <b>Token-saver</b> (gate CI ≥30 %)&ensp;·&ensp;🩺 <b>vkm-doctor</b> — tokens y caché, 100 % local&ensp;·&ensp;📝 <b>vkm-spec</b> idea → spec&ensp;·&ensp;🛠️ <b>Skills</b> <code>/vkm-discipline</code> · <code>/vkm-spec</code> · <code>/vkm-design</code> · <code>/vkm-research</code>&ensp;·&ensp;🕶️ <b>Web sigilosa</b> (obscura, opt-in)
</p>

---

## Instalación rápida · Quick install

**Un comando** conecta tu editor a un vault (lo crea si no existe, fusiona `mcp.json` sin romper
otras entradas, hace backup). Sin parámetros = asistente interactivo; con `-y` no pregunta nada:

```bash
npx @vkmikc/create-vkm-kit                 # asistente interactivo (pre-marca Codex + Claude)
npx @vkmikc/create-vkm-kit -y              # sin preguntas → ~/Documents/obsidian-memory-vault
npx @vkmikc/create-vkm-kit "<RUTA>" -y     # sin preguntas, en la ruta que elijas
```

El nombre npm antiguo sigue funcionando: `npx @vkmikc/create-obsidian-memory` es un shim que reenvía al paquete nuevo. · The old npm name still works: it forwards to the new package.

> ⚡ **Todo su potencial, en un solo comando · the whole stack in one command — `--full`.**
> Enfocado **primero en Codex y Claude Code**, con **todas las funciones activas por defecto ·
> every feature on by default**: registra el MCP en ambos, activa la búsqueda híbrida (BM25,
> semántica y grafo), el **grafo de conocimiento** (relaciones tipadas y observaciones), los
> **memory reports**, la **aceleración sqlite-vec**, la **seguridad multi-escritor** (etag,
> `ifMatch` y lock de escritura, ADR-0037) y el **bucle de memoria evolutiva** (recall de fallos,
> boost por uso, propuestas de `memory-reflect`, ADR-0038), instala el backend Python, construye el
> índice e instala las reglas — sin preguntas. Córrelo desde un clon del kit (o pásale
> `--repo-root <clon>`):
>
> ```bash
> npx @vkmikc/create-vkm-kit --full          # = --ide codex,claude --with-hybrid --semantic --vec --build-index --install-backend --rules --obscura
> ```
>
> Si no hay clon a mano, `--full` **no aborta**: cae a `basic-memory` (sin híbrido) y avisa.

¿Prefieres que **un agente lo instale**? Dile _«linkea el repo e instálalo con todas sus
herramientas y capacidades»_: clona y ejecuta `npm install` + `npm run setup` — preflight de
dependencias → instalación `--full` (memoria híbrida + token-saver + vkm-doctor + vkm-spec +
skills) → verificación → aviso de reinicio. · _Prefer an agent to do it?_ Tell it _"link the repo
and install it with all its tools and capabilities"_ — it clones and runs `npm install` then
`npm run setup`. Paso a paso · step-by-step:
[🇪🇸 instalar con agente](docs/es/instalar-con-agente.md) ·
[🇬🇧 install with an agent](docs/en/install-with-agent.md).

> 🤖 **Claude Code / Codex (PC nuevo · fresh PC):** `--full` ya registra el MCP vía
> `claude mcp add` / `codex mcp add` y construye el índice en el mismo comando. Para Claude Code
> además deja el vault como **única** memoria: apaga la auto-memoria nativa (`autoMemoryEnabled:false`),
> instala un hook `SessionStart` del vault (ADR-0029), dos hooks de aplicación determinista —
> bloqueo de escritura a la memoria nativa + recordatorio de cierre — para que funcione con
> cualquier modelo (ADR-0030), y un hook de "effort gate" que pausa de verdad antes de
> ediciones sustanciales hasta que el usuario confirma (ADR-0031). ¿Solo lo básico? usa
> `--ide codex,claude`.
> Guía completa: [🇪🇸 instalar en PC nueva](docs/es/instalar-pc-nueva.md) ·
> [🇬🇧 fresh-PC install](docs/en/install-fresh-pc.md).

Luego pega las **User Rules** y verifica. Los pasos completos (y la verificación) están en la guía:

<table>
<tr>
<td align="center" width="50%">

🇪🇸 **[Guía de instalación →](docs/es/instalacion.md)**

o deja que [**un agente lo instale**](docs/es/instalar-con-agente.md)

</td>
<td align="center" width="50%">

🇬🇧 **[Install guide →](docs/en/install.md)**

or let [**an agent install it**](docs/en/install-with-agent.md)

</td>
</tr>
</table>

---

## Qué incluye · What's inside

| Pieza · Piece                                                    | Lenguaje | Rol                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/create-vkm-kit/`](packages/create-vkm-kit/)           | Node     | Instalador `npx` **(npm)**: memoria + token-saver + telemetría + skills en un comando.                                                                                                                                                                                                  |
| [`packages/obsidian-memory-mcp/`](packages/obsidian-memory-mcp/) | Node     | MCP "híbrido" **(privado; corre desde el clon)**: tools del vault + búsqueda léxica/semántica.                                                                                                                                                                                          |
| [`packages/obscura-web/`](packages/obscura-web/)                 | Node     | MCP de web sigilosa **(opt-in `--obscura`; corre desde el clon)**: `obscura_fetch` + `obscura_search` (SearXNG → SERP multi-motor → fallback nativo) + `obscura_research` (crawl profundo y rankeo BM25 100% local, cero tokens extra — ADR-0054) vía el navegador headless obscura.    |
| [`packages/obsidian-memory-rag/`](packages/obsidian-memory-rag/) | Python   | Motor de búsqueda FTS5/BM25 + vectorial **(`pip install -e` desde el código)**; cero dependencias por defecto.                                                                                                                                                                          |
| [`packages/vkm-doctor/`](packages/vkm-doctor/)                   | Node     | Sink OTLP local + doctor de uso/caché: tokens, coste y salud de la caché, todo en tu máquina.                                                                                                                                                                                           |
| [`packages/vkm-spec/`](packages/vkm-spec/)                       | Node     | De idea a spec XML anclada al vault (GUI en `127.0.0.1:4923`; Ollama `phi4-mini` opcional, fallback determinista).                                                                                                                                                                      |
| [`packages/vkm-downloads/`](packages/vkm-downloads/)             | Node     | MCP de descargas guiadas **(opt-in `--downloads`; adrede fuera de `--full` — escribe a disco; corre desde el clon)**: `download_resolve` (solo metadatos) → confirmar → descargar a `~/Downloads/vkm-kit/`; jobs en segundo plano con resume, sets y mirror más rápido (ADR-0058/0059). |
| [`cmd/obsidian-memoryd/`](cmd/obsidian-memoryd/)                 | Go       | Daemon opcional: vigila el vault y sincroniza git.                                                                                                                                                                                                                                      |

> ℹ️ **obscura** es software de terceros bajo licencia **Apache-2.0** ([h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura)). El kit **lo descarga** del release oficial y lo verifica por SHA-256 — **no lo empaqueta ni redistribuye**. Búsqueda estructurada vía **SearXNG on-demand** (se levanta solo al buscar, se apaga al terminar; monitor de escritorio opcional) — [ADR-0052](docs/adr/0052-searxng-on-demand-lifecycle.md).
>
> 🧭 **Skills que instala el kit** (además de los paquetes): **`/vkm-discipline`** — disciplina de ejecución cross-dominio (infiere la intención real, entrega más que lo literal, con evidencia ejecutada) que sube el rendimiento de **cualquier modelo**, Haiku a Opus — **`/vkm-spec`** (idea → spec anclada al vault) — y **`/vkm-design`** (diseño profesional anti-genérico para cualquier UI/medio: dirección antes de píxeles, checks computados, librerías reales verificadas online, loop visual). Detalle: [ADR-0049](docs/adr/0049-discipline-doctrine-three-channels.md) y [ADR-0053](docs/adr/0053-vkm-design-skill.md).

Mapa técnico completo y diagramas de flujo: [`ARCHITECTURE.md`](ARCHITECTURE.md). El _porqué_ de
cada decisión: [`docs/adr/`](docs/adr/).

**Economía de tokens, medida y con candado en CI · Token economy, measured and CI-locked:** recall
passage-first **−62%** vs leer notas enteras (coste real del wire, k=3), `assemble_context`
**−68% de tokens de wire (mediana)** vs encadenar búsquedas (gate CI 0.60/0.90), token-saver
**≥30% de compactación con cero pérdida de diagnóstico** (gate CI) y **≈ −1.300 tokens/sesión**
de renta fija (schemas + hook + bloque de reglas) — cada número tiene un gate que **rompe el build**
si regresa. Detalle · detail: [🇪🇸 cómo funciona](docs/es/como-funciona.md) ·
[🇬🇧 how it works](docs/en/how-it-works.md) · [`evals/`](evals/).

---

## Más · More

- **Después de instalar · After installing:** [🇪🇸 guía de uso + situacional](docs/es/guia-de-uso.md) · [🇬🇧 usage + situational guide](docs/en/usage.md).
- **¿Vienes de 3.x? · Coming from 3.x?** [🇪🇸 Migración a 4.0](docs/es/migracion-4.0.md) · [🇬🇧 4.0 migration](docs/en/migration-4.0.md).
- **Seguridad / confianza:** [`SECURITY.md`](SECURITY.md) — el vault es **datos**, no instrucciones.
- **PC nuevo · Fresh PC (Claude Code):** [🇪🇸 instalar en PC nueva](docs/es/instalar-pc-nueva.md) · [🇬🇧 fresh-PC install](docs/en/install-fresh-pc.md).
- **Comparación con alternativas:** [FAQ 🇪🇸](docs/es/faq.md) · [FAQ 🇬🇧](docs/en/faq.md).
- **Contribuir:** [`CONTRIBUTING.md`](CONTRIBUTING.md) · **Para agentes que tocan este repo:** [`AGENTS.md`](AGENTS.md).
- **Privacidad / telemetría:** [`docs/observability.md`](docs/observability.md).

## Licencia · License

Libre uso con atribución visible obligatoria (base MIT) — ver [`LICENSE.md`](LICENSE.md). **No es
MIT estándar ni una licencia aprobada por la OSI**: la cláusula de atribución visible obligatoria
queda fuera de la definición open source de la OSI. Por eso cada `package.json` la declara como
`"license": "SEE LICENSE IN LICENSE.md"` — ningún escáner debe clasificarla como MIT.
