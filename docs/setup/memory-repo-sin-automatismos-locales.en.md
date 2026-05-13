# Agent memory inside one git repo: no extra local automation

**Goal:** keep **agent memory** (Markdown + `basic-memory` MCP) in a **git repo** you already update through your normal workflow — **without** a second timer or maintenance installers on your PC.

## Core idea

1. Use a **private git clone** that holds both your fork/layout and the agent note tree (or a repo dedicated to memory).
2. In Cursor, set MCP `BASIC_MEMORY_HOME` to a path **inside that clone** (absolute), e.g. `D:\work\my-setup\memory` or the repo root if your notes live there.
3. **“Self-updating”** here means: a single **`git pull` / `git push`** keeps **code + docs + versioned memory** aligned. You do **not** need a second channel (timer, daemon) whose only job is “refresh memory”.

## What updates what

| Goal                                            | How (no local automation)                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Upstream **public kit** templates & docs        | `git pull` from upstream into your fork/clone; merge/rebase as usual.                   |
| **Your** notes (`MEMORY.md`, `PROJECTS/`, …)    | Same repo: commit + push when you wrap work; on another machine, `git pull`.            |
| Canonical **AGENTS** text in _this_ public repo | Maintainers use `npm run sync-agents` in CI/PRs (kit metadata, not your private vault). |

## Suggested layout (private)

In a **private repo** (do not publish secrets to a public GitHub repo):

```text
my-agent-memory/
  memory/                 # BASIC_MEMORY_HOME = this folder
    .obsidian/              # optional (Obsidian); not required by basic-memory
    START_HERE.md
    MEMORY.md
    SESSION_LOG.md
    PROJECTS/
  README.md                 # how to open in Cursor
```

- Cursor `mcp.json`: `uvx basic-memory mcp` with `BASIC_MEMORY_HOME` = absolute path to `.../my-agent-memory/memory`.
- Open **`my-agent-memory`** (or `memory` as the workspace root) in Cursor so any `.vscode` at that level applies.

## Honest limits

- There is **no** background “auto-sync” without _some_ actor: either **you** run `git pull`, or you add **cloud CI** (GitHub Actions on _your_ repo). That is not Task Scheduler on your PC, but it is still automation on a server. This doc assumes **git-only on your machine**.
- **Always-on HTTP MCP** (`8765`) requires a long-lived listener; see [`windows-basic-memory-always-on.en.md`](./windows-basic-memory-always-on.en.md) — a different trade-off.

## How this relates to the rest of the kit

- The “separate vault under `Documents` + scheduled tasks” path remains in [`windows-scheduled-vault-sync.en.md`](./windows-scheduled-vault-sync.en.md) for users who want timed Windows sync.
- This pattern is the **minimal** alternative: one git tree, stdio MCP, zero Task Scheduler.

## Español

Mismo contenido: [`memory-repo-sin-automatismos-locales.md`](./memory-repo-sin-automatismos-locales.md).
