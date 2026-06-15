# @vkmikc/create-obsidian-memory

Interactive initializer for **Obsidian-style, file-based agent memory** — a Markdown vault your
AI coding agent reads and writes across sessions, wired to your IDE over **MCP**.

It configures the [`basic-memory`](https://github.com/basicmachines-co/basic-memory) MCP server
(and, optionally, the `obsidian-memory-hybrid` BM25 + semantic retrieval sidecar) for **Cursor**
and/or **Claude Code**, points it at your vault, and can build the local search index — in one
command.

Part of the [obsidian-memory-kit](https://github.com/Vahlame/obsidian-memory-kit)
kit. Full docs (English + Spanish), architecture and ADRs live there.

## Quick start

```bash
# Interactive wizard (recommended the first time)
npm create @vkmikc/obsidian-memory@latest

# One-shot, no questions — vault defaults to ~/Documents/cursor-memory-vault (created if missing)
npx @vkmikc/create-obsidian-memory@latest -y

# …or point it at any folder (created if it doesn't exist)
npx @vkmikc/create-obsidian-memory@latest ./my-vault -y
```

The wizard asks for your vault path and which IDE(s) to wire; the `-y` form skips all prompts. Either
way it writes the MCP config and scaffolds a starter vault (`START_HERE.md`, `MEMORY.md`, `PROJECTS/`,
`SESSION_LOG.md`).

## One-command, non-interactive (CI / fresh PC)

```bash
# Cursor + Claude Code, hybrid search with multilingual embeddings, index built — from a kit clone
node packages/create-obsidian-memory/src/index.js --non-interactive \
  --vault "$HOME/my-vault" --ide cursor,claude \
  --with-hybrid --semantic --build-index --repo-root .
```

`--with-hybrid` needs a local clone of the kit (it wires the Node bridge + Python backend), so run
it from the clone or pass `--repo-root <clone>`. The plain `basic-memory` path needs no clone.

## Options

| Flag                               | Purpose                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--lang en`                        | English prompts (default is Spanish-first).                                                                          |
| `--dry-run`                        | Print the merged Cursor `mcp.json` only — no writes.                                                                 |
| `-y`, `--yes`, `--non-interactive` | Headless mode (no prompts).                                                                                          |
| `[vault]` (positional)             | Vault path as the first argument (e.g. `… ./my-vault -y`); same as `--vault`.                                        |
| `--vault <path>`                   | Vault root (absolute or cwd-relative). Optional — defaults to `~/Documents/cursor-memory-vault`, created if missing. |
| `--ide <list>`                     | IDEs to wire, comma-separated: `cursor`, `claude` (default: `cursor`).                                               |
| `--no-cursor-mcp`                  | Skip writing `~/.cursor/mcp.json`.                                                                                   |
| `--no-git-init`                    | Skip `git init` when the vault has no `.git`.                                                                        |
| `--with-hybrid`                    | Also wire `obsidian-memory-hybrid` (needs a kit clone; use `--repo-root` or cwd walk).                               |
| `--repo-root <path>`               | Root of the `obsidian-memory-kit` clone (hybrid bridge + Python source).                                             |
| `--semantic`                       | With `--with-hybrid`: neural embeddings (fastembed multilingual; needs the `[semantic]` extra).                      |
| `--build-index`                    | After wiring, build the local FTS (+ semantic) index (needs the Python backend).                                     |
| `--with-gitleaks`                  | Install a gitleaks pre-commit hook in `<vault>/.git/hooks/`.                                                         |
| `--help`                           | Show usage.                                                                                                          |

- `cursor` writes `~/.cursor/mcp.json`.
- `claude` registers servers via the Claude Code CLI (`claude mcp add -s user`).

## Requirements

- **Node.js ≥ 20**
- **[`uv`](https://docs.astral.sh/uv/)** (for `uvx basic-memory mcp`)
- For `--with-hybrid` / `--build-index`: **Python ≥ 3.11** and the kit's `obsidian-memory-rag` package.
- For `--ide claude`: the **Claude Code** CLI on `PATH`.

## License

MIT © Vahlame. See the [repository](https://github.com/Vahlame/obsidian-memory-kit) for details.
