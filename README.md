<p align="center">
  <img src="docs/assets/hero.svg" alt="Tu agente habla con servidores MCP, que leen y escriben notas Markdown en tu vault git; un daemon opcional sincroniza con un remoto" width="840">
</p>

<h1 align="center">🧠 Memoria persistente para tu agente de IA</h1>
<h3 align="center">Persistent memory for your AI agent</h3>

<p align="center">
  <em>Tus notas en Markdown + git. El modelo las lee y escribe vía MCP. Todo local, todo tuyo.</em><br>
  <em>Your notes in Markdown + git. The model reads & writes them via MCP. All local, all yours.</em>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-blue.svg" alt="MIT"></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/release-v3.0.0-orange.svg" alt="Release"></a>
  <a href="https://github.com/Vahlame/obsidian-memory-kit/actions/workflows/ci.yml"><img src="https://github.com/Vahlame/obsidian-memory-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <b>📖 Documentación completa:</b>&nbsp;
  <a href="docs/es/README.md">🇪🇸 Español</a>&nbsp;·&nbsp;
  <a href="docs/en/README.md">🇬🇧 English</a>
</p>

---

## ¿Qué es esto? · What is this?

🇪🇸 Un **kit multiplataforma** que le da a la IA (Cursor, Claude Code…) una **memoria que
sobrevive entre chats**: una carpeta de notas Markdown bajo git que el agente lee y escribe a
través de **MCP** (el puente entre el editor y tus archivos). Sin servicio en la nube. La pieza
obligatoria es solo el servidor MCP; lo demás (búsqueda semántica, daemon de sync) es opcional.

🇬🇧 A **cross-platform kit** that gives your AI (Cursor, Claude Code…) **memory that survives
across chats**: a folder of Markdown notes under git that the agent reads and writes through
**MCP** (the bridge between the editor and your files). No cloud service. The only required piece
is the MCP server; everything else (semantic search, sync daemon) is optional.

> ¿Cómo fluye la información? El diagrama de arriba lo resume; el detalle visual está en
> [**Cómo funciona**](docs/es/como-funciona.md) · [**How it works**](docs/en/how-it-works.md).

---

## Instalación rápida · Quick install

**Un comando** conecta tu editor a un vault (lo crea si no existe, fusiona `mcp.json` sin romper
otras entradas, hace backup). Sin parámetros = asistente interactivo; con `-y` no pregunta nada:

```bash
npx @vkmikc/create-obsidian-memory                 # asistente interactivo
npx @vkmikc/create-obsidian-memory -y              # sin preguntas → ~/Documents/obsidian-memory-vault
npx @vkmikc/create-obsidian-memory "<RUTA>" -y     # sin preguntas, en la ruta que elijas
```

> 🤖 **Claude Code (PC nuevo · fresh PC):** registra el MCP vía `claude mcp add` y construye el
> índice en el mismo comando — añade `--ide cursor,claude --with-hybrid --build-index`. Guía
> completa: [🇪🇸 instalar en PC nueva](docs/es/instalar-pc-nueva.md) ·
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

| Pieza · Piece                                                          | Lenguaje | Rol                                                                                                            |
| ---------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| [`packages/create-obsidian-memory/`](packages/create-obsidian-memory/) | Node     | Instalador `npx` **(npm)**: fusiona el MCP y crea el vault.                                                    |
| [`packages/obsidian-memory-mcp/`](packages/obsidian-memory-mcp/)       | Node     | MCP "híbrido" **(privado; corre desde el clon)**: tools del vault + búsqueda léxica/semántica.                 |
| [`packages/obsidian-memory-rag/`](packages/obsidian-memory-rag/)       | Python   | Motor de búsqueda FTS5/BM25 + vectorial **(`pip install -e` desde el código)**; cero dependencias por defecto. |
| [`cmd/obsidian-memoryd/`](cmd/obsidian-memoryd/)                       | Go       | Daemon opcional: vigila el vault y sincroniza git.                                                             |

Mapa técnico completo y diagramas de flujo: [`ARCHITECTURE.md`](ARCHITECTURE.md). El _porqué_ de
cada decisión: [`docs/adr/`](docs/adr/).

---

## Más · More

- **Seguridad / confianza:** [`SECURITY.md`](SECURITY.md) — el vault es **datos**, no instrucciones.
- **PC nuevo · Fresh PC (Claude Code):** [🇪🇸 instalar en PC nueva](docs/es/instalar-pc-nueva.md) · [🇬🇧 fresh-PC install](docs/en/install-fresh-pc.md).
- **Comparación con alternativas:** [FAQ 🇪🇸](docs/es/faq.md) · [FAQ 🇬🇧](docs/en/faq.md).
- **Contribuir:** [`CONTRIBUTING.md`](CONTRIBUTING.md) · **Para agentes que tocan este repo:** [`AGENTS.md`](AGENTS.md).
- **Privacidad / telemetría:** [`docs/observability.md`](docs/observability.md).

## Licencia · License

MIT — ver [`LICENSE`](LICENSE).
