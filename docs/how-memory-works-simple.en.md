# How this memory system works (plain-language, complete)

This page is **words only**: it does not assume you know MCP or FTS. If you want the install path, start at [`../GETTING_STARTED.en.md`](../GETTING_STARTED.en.md).

## The problem it solves

AI chats **do not reliably keep** what you agreed in a previous session. Each thread starts “blank” about your life, team, or project unless you paste context into the prompt.

This memory **does not live inside the model**. It lives in **text files** (Markdown) on **your computer**, in a folder you control. You can read, edit, search, and version them with **git** like any other project.

## The idea in one sentence

You keep a **folder of notes** (the “vault”). A **small program** (the MCP server, default `basic-memory`) connects to the editor and gives the model **tools** to read and write those notes. Optionally you paste **fixed text rules** in Cursor (“User Rules”) so the model **uses** those tools in a sensible order (for example: `START_HERE.md`, then `MEMORY.md`, then the active project).

**Sync and “always-on” MCP (v3, public kit):** by default the IDE uses **`basic-memory` over stdio** (no separate long-lived process required). To keep the vault in **git** with low friction we document **`obsidian-memoryd watch`** or **manual git**. Persistent HTTP and Windows tasks are **optional** and owned by the installer — the kit **no longer ships** `.ps1`/`.vbs` in the repo. If you followed the v2 kit script model, read **[`docs/migration/v2-to-v3-script-free-kit.en.md`](./migration/v2-to-v3-script-free-kit.en.md)**.

## Three pieces (and why all three matter)

### 1. The vault (folder + Markdown + git)

A folder with files like:

- `START_HERE.md`: short index; “where to start”.
- `MEMORY.md`: things you want the model to remember **globally** (preferences, lessons that span many projects).
- `PROJECTS/something.md`: context for **one project** (name similar to the repo folder you work in).
- `SESSION_LOG.md`: a short timeline of “what happened today” (decisions, task closures).

**Why git:** you get history (`git log`), diffs, and an optional remote (private GitHub) for another machine or backup. The **public** repo you are reading is **not** your vault; your vault is **yours** and usually **private**.

### 2. MCP (bridge between the IDE and the folder)

**MCP** (“Model Context Protocol”) is how Cursor (or another client) launches a process and asks it to perform operations: read note, write note, search, etc.

In v2 the default server is **`basic-memory`**, started with `uvx basic-memory mcp`. The **`BASIC_MEMORY_HOME`** variable tells it **which folder** is the vault. Without that, the model has **nowhere** to point.

**Important:** MCP does not “think”. It only **opens, saves, and searches files** via the tools it exposes. The model still decides what to request; User Rules help it not skip steps.

### 3. User Rules (Cursor-only; fixed text)

Text you paste in Cursor settings. They **do not** replace MCP: if MCP is down, rules cannot read disk by magic.

They help with:

1. **Reading order:** “start at START_HERE, then MEMORY, then PROJECTS for the current repo”.
2. **Hygiene:** “do not store secrets”, “append closures to SESSION_LOG”, “if MCP is unavailable, say so”.

Ready-to-paste block: [`cursor-memory-setup.en.md`](./cursor-memory-setup.en.md#step-3-user-rules-paste-into-cursor).

## What happens when you chat (mental flow)

1. You open a project in Cursor with MCP configured.
2. The model sees **tools** (read/write/search notes).
3. If it follows your User Rules, it **reads** context notes instead of guessing.
4. When it makes useful decisions, it can **write** to `PROJECTS/...` or `SESSION_LOG.md`.
5. You `git commit` / push when you want (or an optional daemon helps sync).

None of this automatically uploads your notes to the LLM vendor “forever”: what persists is **what you write to files** and what you push to **your** remote if you set one up.

## Optional: very fast search for huge vaults (`obsidian-memory-rag` + hybrid)

`basic-memory` can already search. If the vault is **very large**, a local **SQLite FTS5** index speeds up keyword-in-body search. That is the **`obsidian-memory-rag`** package. The **hybrid MCP** exposes IDE tools to **index** and **search** that store.

Not required to start. It is a **comfort and performance** layer, not the core.

## What this is **not** (to avoid confusion)

- **Not** the same as Cursor **`memory://...` toasts:** that is native / virtual IDE memory; this flow uses **vault files** via MCP.
- **Not** an automatic replacement for Obsidian: you can use Obsidian or any editor; the vault is just files.
- **Not** “cloud memory inside the model”: durable persistence is **your files** and your **git** remote.
- **Not** a guarantee the model always obeys: rules improve behavior, but models err; that is why the vault is human-reviewable.

## Next step

Linear install: [`../GETTING_STARTED.en.md`](../GETTING_STARTED.en.md).

## Español

Misma explicación: [`how-memory-works-simple.md`](./how-memory-works-simple.md).
