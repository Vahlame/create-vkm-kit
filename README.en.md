<p align="center">
  <img src="docs/assets/hero.svg" alt="Your agent talks to MCP servers, which read and write Markdown notes in your git vault; an optional daemon syncs to a remote" width="840">
</p>

<h1 align="center">🧠 Persistent memory for your AI agent</h1>
<h3 align="center">Memoria persistente para tu agente de IA</h3>

<p align="center">
  <em>Your notes in Markdown + git. The model reads &amp; writes them via MCP. All local, all yours.</em><br>
  <em>Tus notas en Markdown + git. El modelo las lee y escribe vía MCP. Todo local, todo tuyo.</em>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/release-v3.10.0-orange.svg" alt="Release"></a>
  <a href="https://github.com/Vahlame/obsidian-memory-kit/actions/workflows/ci.yml"><img src="https://github.com/Vahlame/obsidian-memory-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <b>📖 Read this in:</b>&nbsp;
  <a href="README.en.md">🇬🇧 English</a>&nbsp;·&nbsp;
  <a href="README.md">🇪🇸 Español</a>
  &nbsp;|&nbsp;
  <b>Full docs:</b>&nbsp;
  <a href="docs/en/README.md">🇬🇧 English</a>&nbsp;·&nbsp;
  <a href="docs/es/README.md">🇪🇸 Español</a>
</p>

---

## What is this?

A **cross-platform kit** that gives your AI (Cursor, Claude Code…) **memory that survives across
chats**: a folder of Markdown notes under git that the agent reads and writes through **MCP** (the
bridge between the editor and your files). No cloud service. The only required piece is the MCP
server; everything else (semantic search, sync daemon) is optional.

> How does information flow? The diagram above sums it up; the visual detail is in
> [**How it works**](docs/en/how-it-works.md).

---

## Quick install

**One command** connects your editor to a vault (creates it if missing, merges `mcp.json` without
breaking other entries, makes a backup). No arguments = interactive wizard; with `-y` it asks
nothing:

```bash
npx @vkmikc/create-obsidian-memory                 # interactive wizard (pre-selects Codex + Claude)
npx @vkmikc/create-obsidian-memory -y              # no questions → ~/Documents/obsidian-memory-vault
npx @vkmikc/create-obsidian-memory "<PATH>" -y     # no questions, at the path you choose
```

> ⚡ **The whole stack in one command — `--full`.**
> Focused **on Codex and Claude Code first**, with **every feature on by default**: it registers
> the MCP in both, enables hybrid search (BM25, semantic, and graph), the **knowledge graph**
> (typed relations and observations), the **memory reports**, and the **sqlite-vec acceleration**,
> installs the Python backend, builds the index, and installs the rules — no questions. Run it from
> a clone of the kit (or pass it `--repo-root <clone>`):
>
> ```bash
> npx @vkmikc/create-obsidian-memory --full          # = --ide codex,claude --with-hybrid --semantic --vec --build-index --install-backend --rules
> ```
>
> If no clone is at hand, `--full` **does not abort**: it falls back to `basic-memory` (no hybrid)
> and warns.

Prefer an **agent to install it**? Clone it and tell it _"install it"_: have it run `npm install`
then `npm run setup` — dependency preflight → `--full` install → verification → restart notice.

> 🤖 **Claude Code / Codex (fresh PC):** `--full` already registers the MCP via `claude mcp add` /
> `codex mcp add` and builds the index in the same command. For Claude Code it also makes the vault
> the **only** memory: it turns off Claude Code's native auto-memory (`autoMemoryEnabled:false`) and
> installs a `SessionStart` vault hook (ADR-0029). Just the basics? Use `--ide codex,claude`. Full
> guide: [fresh-PC install](docs/en/install-fresh-pc.md).

Then paste the **User Rules** and verify. The complete steps (and verification) are in the guide:

<p align="center">
  🇬🇧 <b><a href="docs/en/install.md">Install guide →</a></b>
  &nbsp;or let <a href="docs/en/install-with-agent.md"><b>an agent install it</b></a>
</p>

---

## What's inside

| Piece                                                                  | Language | Role                                                                                               |
| ---------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| [`packages/create-obsidian-memory/`](packages/create-obsidian-memory/) | Node     | `npx` installer **(npm)**: merges the MCP and creates the vault.                                   |
| [`packages/obsidian-memory-mcp/`](packages/obsidian-memory-mcp/)       | Node     | "Hybrid" MCP **(private; runs from the clone)**: vault tools + lexical/semantic search.            |
| [`packages/obsidian-memory-rag/`](packages/obsidian-memory-rag/)       | Python   | FTS5/BM25 + vector search engine **(`pip install -e` from source)**; zero dependencies by default. |
| [`cmd/obsidian-memoryd/`](cmd/obsidian-memoryd/)                       | Go       | Optional daemon: watches the vault and syncs git.                                                  |

Full technical map and flow diagrams: [`ARCHITECTURE.md`](ARCHITECTURE.md). The _why_ behind each
decision: [`docs/adr/`](docs/adr/).

---

## More

- **Security / trust:** [`SECURITY.md`](SECURITY.md) — the vault is **data**, not instructions.
- **Fresh PC (Claude Code):** [fresh-PC install](docs/en/install-fresh-pc.md).
- **Comparison with alternatives:** [FAQ](docs/en/faq.md).
- **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md) · **For agents touching this repo:** [`AGENTS.md`](AGENTS.md).
- **Privacy / telemetry:** [`docs/observability.md`](docs/observability.md).

## License

MIT — see [`LICENSE`](LICENSE).
