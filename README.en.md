<p align="center">
  <img src="docs/assets/hero.svg" alt="Your agent talks to MCP servers, which read and write Markdown notes in your git vault; an optional daemon syncs to a remote; below, the vkm-kit efficiency suite: token-saver, vkm-doctor, vkm-spec, skills and obscura-web" width="840">
</p>

<h1 align="center">🧠 Turn any AI into an assistant with permanent memory</h1>
<h3 align="center">Convierte cualquier IA en un asistente con memoria permanente</h3>

<p align="center">
  <a href="./LICENSE.md"><img src="https://img.shields.io/badge/license-MIT--derived_%2B_attribution_(non--OSI)-blue.svg" alt="License"></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/release-v4.7.1-orange.svg" alt="Release"></a>
  <a href="https://github.com/Vahlame/create-vkm-kit/actions/workflows/ci.yml"><img src="https://github.com/Vahlame/create-vkm-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@vkmikc/create-vkm-kit"><img src="https://img.shields.io/npm/v/%40vkmikc%2Fcreate-vkm-kit?label=npm&color=cb3837" alt="npm"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-43853d.svg" alt="Node ≥ 20">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-555.svg" alt="Cross-platform">
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

Your agent forgets everything when the chat closes. This kit gives it memory that **survives across
sessions**: a folder of **Markdown notes in your own git repo**, read and written by the model over
**MCP**. No cloud, no account, no lock-in — delete the kit tomorrow and your notes are still there,
openable in any text editor.

---

## Start in 5 minutes

**1.** One command connects your editor to a vault (creates it if missing, merges your `mcp.json`
without breaking other entries, makes a backup):

```bash
npx @vkmikc/create-vkm-kit -y
```

**2.** **Restart your editor.** MCP servers load at startup; no agent can hot-load them — not even
the one that just installed them.

**3.** In a fresh chat, ask for this:

> _"Read `START_HERE.md` from my vault and tell me what it contains."_

If it answers with the contents, you have persistent memory. **That is everything you need to get
started** — everything below is optional.

<details>
<summary><b>⚡ I want the whole stack in one command (<code>--full</code>)</b></summary>

<br>

Focused **on Codex and Claude Code first**, with **every feature on by default**: it registers the
MCP in both, enables hybrid search (BM25, semantic, and graph), the **knowledge graph** (typed
relations and observations), the **memory reports**, the **sqlite-vec acceleration**,
**multi-writer safety** (etag/`ifMatch` + write lock, ADR-0037) and the **evolutive memory loop**
(failure recall, usage boost, `memory-reflect` proposals, ADR-0038), installs the Python backend,
builds the index, and installs the rules — no questions. Run it from a clone of the kit (or pass it
`--repo-root <clone>`):

```bash
npx @vkmikc/create-vkm-kit --full          # = --ide codex,claude --with-hybrid --semantic --vec --build-index --install-backend --rules --obscura
```

If no clone is at hand, `--full` **does not abort**: it falls back to `basic-memory` (no hybrid) and
warns.

</details>

<details>
<summary><b>🤖 I'd rather an agent installed it for me</b></summary>

<br>

Tell it _"link the repo and install it with all its tools and capabilities"_: it clones and runs
`npm install` then `npm run setup` — dependency preflight → `--full` install (hybrid memory +
token-saver + vkm-doctor + vkm-spec + skills) → verification → restart notice. Step-by-step:
[install with an agent](docs/en/install-with-agent.md).

</details>

<details>
<summary><b>🔧 Other ways to install, and how to keep it current</b></summary>

<br>

```bash
npx @vkmikc/create-vkm-kit                 # interactive wizard (pre-selects Codex + Claude)
npx @vkmikc/create-vkm-kit "<PATH>" -y     # no questions, at the path you choose
```

**Keep it current (ADR-0061).** `--check-update` compares your version against npm and reports which
skill/subagent templates the kit changed — it **writes nothing and never fails** (offline it prints
a "skipped" line and exits 0). `--update` applies that plan: it installs what is missing or what the
kit changed, and **leaves any file you edited untouched** (listed by name; `--force` overwrites it
and **discards your edits**, `--dry-run` previews with zero writes).

**Claude Code / Codex on a fresh PC.** `--full` already registers the MCP via `claude mcp add` /
`codex mcp add` and builds the index in the same command. For Claude Code it also makes the vault
the **only** memory: it turns off Claude Code's native auto-memory (`autoMemoryEnabled:false`),
installs a `SessionStart` vault hook (ADR-0029), two deterministic enforcement hooks — blocking
writes into the native memory + a close-ritual reminder — so it works with any model (ADR-0030), and
an effort-gate hook that makes a pause before substantial edits actually enforced, not just
announced (ADR-0031). Just the basics? Use `--ide codex,claude`. Full guide:
[fresh-PC install](docs/en/install-fresh-pc.md).

The old npm name (`@vkmikc/create-obsidian-memory`) is **deprecated and frozen on the v3 kit
(3.15.0)** — it does not forward to the new package, so repoint any pinned script to
`@vkmikc/create-vkm-kit`.

</details>

Full step-by-step guide, with verification: [**install**](docs/en/install.md). How information
flows: [**how it works**](docs/en/how-it-works.md).

---

## What you get

- 🧠 **Stop repeating context.** Yesterday's decisions, preferences and lessons are still there
  today — in any chat, with any model.
- 💸 **And spend fewer tokens doing it.** Recall returns the **section** that answers, not the whole
  note: a measured **−62%** against reading full notes, with a CI gate that breaks the build if it
  regresses.
- 🔒 **It's yours, and it's readable.** Plain Markdown in your git repo. No note leaves your machine,
  and the day you drop the kit you keep all of them.

<details>
<summary><b>🧩 What's inside (you don't need to know this to use it)</b></summary>

<br>

The **only required piece** is the MCP server. Everything below is optional and switches on when you
ask for it — which is why the install is one command even though the list is long.

| Piece                                                            | Language | Role                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/create-vkm-kit/`](packages/create-vkm-kit/)           | Node     | `npx` installer **(npm)**: memory + token-saver + telemetry + skills in one command.                                                                                                                                                                                                                                                                          |
| [`packages/obsidian-memory-mcp/`](packages/obsidian-memory-mcp/) | Node     | "Hybrid" MCP **(private; runs from the clone)**: vault tools + lexical/semantic search.                                                                                                                                                                                                                                                                       |
| [`packages/obscura-web/`](packages/obscura-web/)                 | Node     | Stealth web MCP **(opt-in `--obscura`; runs from the clone)**: `obscura_fetch` + `obscura_search` (SearXNG → multi-engine SERP → native fallback) + `obscura_research` (deep crawl + BM25 ranking, 100% local, zero extra tokens — ADR-0054) + `obscura_research_start` (background research jobs, up to 30 min — ADR-0060) via the obscura headless browser. |
| [`packages/obsidian-memory-rag/`](packages/obsidian-memory-rag/) | Python   | FTS5/BM25 + vector search engine **(`pip install -e` from source)**; zero dependencies by default.                                                                                                                                                                                                                                                            |
| [`packages/vkm-doctor/`](packages/vkm-doctor/)                   | Node     | Local OTLP sink + usage/cache doctor: tokens, cost, and cache health — all on your machine.                                                                                                                                                                                                                                                                   |
| [`packages/vkm-spec/`](packages/vkm-spec/)                       | Node     | Idea → vault-grounded XML spec (GUI on `127.0.0.1:4923`; optional Ollama `phi4-mini`, deterministic fallback).                                                                                                                                                                                                                                                |
| [`packages/vkm-downloads/`](packages/vkm-downloads/)             | Node     | Guarded downloads MCP **(opt-in `--downloads`; deliberately outside `--full` — it writes to disk; runs from the clone)**: `download_resolve` (metadata only) → confirm → download into `~/Downloads/vkm-kit/`; background jobs with resume, sets and fastest-mirror (ADR-0058/0059).                                                                          |
| [`cmd/obsidian-memoryd/`](cmd/obsidian-memoryd/)                 | Go       | Optional daemon: watches the vault and syncs git.                                                                                                                                                                                                                                                                                                             |

> ℹ️ **obscura** is third-party software under the **Apache-2.0** license ([h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura)). The kit **downloads** the official release and verifies it by SHA-256 — it does **not** bundle or redistribute it. Structured search runs via **on-demand SearXNG** (started only while searching, stopped when idle; optional desktop monitor) — [ADR-0052](docs/adr/0052-searxng-on-demand-lifecycle.md).
>
> 🧭 **Skills the kit installs** (besides the packages): **`/vkm-discipline`** — cross-domain execution discipline (infer the real intent, deliver more than the literal ask, with run evidence) that lifts **any model**, Haiku to Opus — **`/vkm-spec`** (idea → a spec anchored to the vault) — and **`/vkm-design`** (professional, anti-generic design for any UI/medium: direction before pixels, computed checks, real libraries verified online, a visual loop). Detail: [ADR-0049](docs/adr/0049-discipline-doctrine-three-channels.md) and [ADR-0053](docs/adr/0053-vkm-design-skill.md).

Full technical map and flow diagrams: [`ARCHITECTURE.md`](ARCHITECTURE.md). The _why_ behind each
decision: [`docs/adr/`](docs/adr/). Every piece and every connection, with per-operation sequence
diagrams: [architecture deep dive](docs/en/architecture-deep-dive.md).

</details>

<details>
<summary><b>📊 The numbers, and the CI gates holding them</b></summary>

<br>

**Token economy, measured and CI-locked:** passage-first recall costs **−62%** vs whole-note reads
(true wire cost, k=3), `assemble_context` **−68% median wire tokens** vs chaining searches
(CI gate 0.60/0.90), the token-saver compacts noisy output **≥30% with zero diagnostic loss**
(CI gate), plus **≈ −1,300 tokens/session** of fixed rent (schemas + hook + rules
block) — every number has a gate that **breaks the build** if it regresses (fixed labelled
corpus + deterministic embedder: reproducible regression floors, not leaderboard claims). Detail:
[how it works](docs/en/how-it-works.md) · [`evals/`](evals/).

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-results-dark.svg">
    <img src="docs/assets/bench-results.svg" alt="Dumbbell chart: puntuación con skill vs stock por bench y modelo — research-bench, design-bench y discipline-bench suben con la skill en Sonnet y Opus; Haiku plano en design" width="880">
  </picture>
</p>

**And with live models (2026-07-21 round, Haiku 4.5 + Sonnet 5, raw data committed):** all
4 skills route with **100% hit-rate and 0% false-positives** (104 ES+EN cases); the
token-saver's pre-registered A/B showed **0.0 quality delta** with the log **~81% smaller**
(verdict: keep — and the rule says a mechanism that degrades **gets removed**);
`/vkm-discipline` lifts Haiku **from 47.0 to 91.7 (+44.7)** on the under-specified task with
Sonnet unaffected. A CI **e2e smoke** also proves the whole stack over real stdio
(install → index → search → write → search-again), and per-query latency is gated
(measured p95 ~3 ms). All reproducible: [`evals/skills-triggering/`](evals/skills-triggering/) ·
[`evals/token-quality-ab/`](evals/token-quality-ab/) · [`evals/discipline-bench/`](evals/discipline-bench/).

</details>

---

## More

- **After installing:** [usage + situational guide](docs/en/usage.md) ([🇪🇸 guía de uso](docs/es/guia-de-uso.md)).
- **Coming from 3.x?** [4.0 migration](docs/en/migration-4.0.md) ([🇪🇸 migración a 4.0](docs/es/migracion-4.0.md)).
- **Security / trust:** [`SECURITY.md`](SECURITY.md) — the vault is **data**, not instructions.
- **Fresh PC (Claude Code):** [fresh-PC install](docs/en/install-fresh-pc.md).
- **Comparison with alternatives:** [FAQ](docs/en/faq.md).
- **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md) · **For agents touching this repo:** [`AGENTS.md`](AGENTS.md).
- **Versioning:** SemVer over the installed contract; majors frozen except unavoidable breaks — [policy](CONTRIBUTING.md#versioning-policy-post-4x).
- **Privacy / telemetry:** [`docs/observability.md`](docs/observability.md).

## License

Free use with mandatory visible attribution (MIT-based) — see [`LICENSE.md`](LICENSE.md). **This is
not standard MIT nor an OSI-approved license**: the mandatory visible-attribution clause falls
outside the OSI open-source definition. That's why every `package.json` declares it as
`"license": "SEE LICENSE IN LICENSE.md"` — no scanner should classify it as MIT.
