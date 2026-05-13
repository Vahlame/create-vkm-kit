# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - v3.0.0

### Breaking change

- **v3 kit layout (same branch: `main`):** the repository **no longer ships** Windows integration files under **`scripts/windows/`** (`.ps1`, `.vbs`) or convenience scripts under **`tools/*.ps1`**. The **advanced** setup (MCP stdio/HTTP, vault git, FTS hybrid) is unchanged in intent and is documented without those artifacts. Migration: [`docs/migration/v2-to-v3-script-free-kit.md`](./docs/migration/v2-to-v3-script-free-kit.md) / [`.en.md`](./docs/migration/v2-to-v3-script-free-kit.en.md). Maintainers still use **`scripts/sync-agents.ts`** (TypeScript) and **`.github/scripts/extract-and-lint.ps1`** (CI against the archived v1 prompt).
- **Platform & IDE:** v2+ targets **Windows, Linux, and macOS** and is **IDE-agnostic** (`AGENTS.md` + synced rules). The v1 “paste ultra-prompt in Cursor only” flow is archived under `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md`.
- **MCP server:** `@smith-and-web/obsidian-mcp-server` (SSE :3001) is replaced by **`basic-memory`** (`uvx basic-memory mcp`, Streamable HTTP). Optional **cyanheads `obsidian-mcp-server`** add-on documented. `mcp-remote` minimum **`^0.1.16`** when bridging.
- **Automation:** prefer **`obsidian-memoryd`** or your own scheduler; v1 Windows patterns remain documented only under **`docs/legacy/`** and ADR-0003 (historical).
- **Manifest:** `manifest.json` / `schema.json` **removed** in favor of `agent.toml` + `agents-manifest.yaml` for tooling (see ADR-0011).

### Removed

- **`scripts/windows/`** — `Start-BasicMemoryMcp.ps1`, `Run-Hidden.vbs`, `Get-CursorScheduledTaskConsoleRisk.ps1`, `Start-ObsidianMemorydWatch.ps1` (v3: no kit-shipped Windows integration scripts).
- **`tools/*.ps1`** — `monitor-console-live.ps1`, `windows-reset-agent-memory.ps1`, `purge-memory-mcp-cache.ps1` (replaced by manual steps in docs; see `tools/README.md`).

### Added

- **`docs/migration/v2-to-v3-script-free-kit.md`** / **`.en.md`**: capítulo **v2 → v3** (integración avanzada sin scripts del kit; todo en `main`).
- ADR-0010–0015 (basic-memory, `AGENTS.md`, Go daemon, Syncthing, hybrid RAG, generic privacy notes in docs).
- **`obsidian-memory-hybrid` MCP** (`vault_fts_search`, `vault_fts_index`) bridging Node MCP → Python FTS5; sample `config/mcp/obsidian-memory-hybrid.json`.
- `cmd/obsidian-memoryd/` cross-platform daemon skeleton + `.github/workflows` updates for Go/Node/Python/evals.
- `packages/create-obsidian-memory`, `packages/obsidian-memory-rag`, `packages/obsidian-memory-mcp` (initializer, optional RAG, complementary MCP).
- `scripts/sync-agents.ts`, `.agents/rules/`, eval suite `evals/adherence.yaml` + `evals/run-adherence-ci.mjs` (CI gate), optional `compose.observability.yml`.
- `docs/benchmarks/retrieval.md`, `docs/testing/manual-checks.md`, **`docs/testing/windows-memory-sync-smoke.md`** / **`.en.md`** (checklist Windows opcional: tareas propias, git, MCP HTTP, FTS).
- **`obsidian-memory-rag`:** incremental SQLite **FTS5** indexer, BM25 `search`, `bench`, and **`json-search` / `json-index`** for MCP bridging (stdlib-only; sqlite-vec deferred).
- **`create-obsidian-memory`:** writes Cursor `mcp.json` merge for `basic-memory`, vault scaffold (`START_HERE`, `MEMORY`, `SESSION_LOG`, `PROJECTS`, `.gitignore`), **`vault/.vscode/settings.json`** merged on each `--vault` run (calmer Git SCM on Windows), `--dry-run` / `--help`, and **`--non-interactive` / `--yes`** with **`--vault`** (plus **`--no-cursor-mcp`**, **`--no-git-init`**) for CI/scripts.
- **`docs/migration/v1-prompt-closure.md`**, root **`PROMPT_ULTRA_COMPLETO.{linux,macos}.md`** (redirect stubs per ADR-0007 amendment).
- FAQ + glossary aligned with v2 transport, uninstall, and large-vault FTS path.
- **`GETTING_STARTED.md` / `GETTING_STARTED.en.md`**: tabla de pasos (flujo lineal instalación / verificación).
- **`docs/how-memory-works-simple.md`** / **`docs/how-memory-works-simple.en.md`**: modelo mental (vault, MCP, User Rules) + párrafo **v3** (sync / MCP) y enlace a `v2-to-v3-script-free-kit`.
- **`docs/setup/windows-scheduled-vault-sync.md`** / **`.en.md`**: opciones Windows para git del vault **sin** plantillas PowerShell/VBS del kit (`obsidian-memoryd watch`, git manual, tareas propias).
- **`docs/setup/windows-basic-memory-always-on.md`** / **`.en.md`**: HTTP opcional para `basic-memory` vía **comandos** o tarea que definas tú; **stdio** como camino por defecto; plantilla `config/mcp/basic-memory-streamable-http.json`.
- **`docs/cursor-memory-setup.md`** / **`docs/cursor-memory-setup.en.md`**: end-to-end Cursor guide (vault vs MCP vs User Rules, verification, ready-to-paste User Rules for `basic-memory` + optional hybrid).
- **ADR-0016:** puerto localhost por defecto **8765** para `basic-memory` Streamable HTTP (evitar colisiones con 8000/8080/3000).
- **`.vscode/settings.json`** (repo root) and **`examples/.vscode/settings.json`**: workspace defaults that reduce Git/`conhost` churn on Windows when the folder is opened in Cursor or VS Code.
- **`docs/setup/windows-sin-consola-visible.md`** / **`.en.md`**: checklist (workspace, tareas opcionales, MCP, límites) sin scripts de auditoría del kit.
- **`docs/setup/memory-repo-sin-automatismos-locales.md`** / **`.en.md`**: memoria del agente en el mismo clon git — sin automatismos locales extra.
- **`GETTING_STARTED.md` / `.en.md`**: paso 8 enlaza a esa alternativa mínima.

### Fixed

- **Docs onboarding:** `docs/troubleshooting.md` alineado a **v2** (MCP `basic-memory`, recuperación sin flujo v1); v1 solo como referencia en `docs/legacy/`. `README.md` / `README.en.md` — paso opcional a [`memory-repo-sin-automatismos-locales`](./docs/setup/memory-repo-sin-automatismos-locales.md).
- **`docs/troubleshooting.md`:** `fetch failed` / `basic-memory` URL rojo — causa adicional **puerto ocupado por otra app**; arreglo con `netstat` + mismo puerto en el **listener** y `mcp.json`. Nota **`ECONNREFUSED`** tras editar `mcp.json` (arranque frío `uvx`). Entrada **muchas ventanas CMD** (Cursor + `node`/`uvx`).
- **`create-obsidian-memory` / Windows:** merge sets **`git.path`** to **`…\Git\cmd\git.exe`** when found (avoids focus-stealing `bin\git.exe` / `bin\sh.exe` windows); workspace JSON includes **`git.terminalAuthentication`: false**.
- **`create-obsidian-memory`:** strip UTF-8 BOM before parsing existing `~/.cursor/mcp.json` so merges keep prior `mcpServers` entries (PowerShell / some editors emit BOM); merge kit Git/SCM keys into **existing** `vault/.vscode/settings.json` (previously skipped when the file existed, so old vaults never picked up new quiet defaults).
- **`obsidian-memory-hybrid`:** default `PYTHONPATH` for monorepo dev pointed at the wrong sibling folder; corrected to `packages/obsidian-memory-rag/src` relative to the hybrid script.

### Changed

- **Capítulo v2 → v3:** guía pública **stdio + `obsidian-memoryd` / git manual** por defecto; HTTP y tareas Windows como opciones **definidas por quien instala**. [`docs/migration/v2-to-v3-script-free-kit.md`](./docs/migration/v2-to-v3-script-free-kit.md) / [`.en.md`](./docs/migration/v2-to-v3-script-free-kit.en.md).
- **Guías Windows sin plantillas del kit:** `windows-scheduled-vault-sync*`, `windows-basic-memory-always-on*`, `windows-sin-consola-visible*`, `windows-juego-vault-sync*`, `windows-memory-sync-smoke*`, `docs/troubleshooting.md` — sin `.ps1`/`.vbs` publicados para copiar; HTTP y git descritos con **stdio**, **terminal**, **`obsidian-memoryd`** o automatismo propio.
- **`obsidian-memoryd watch`:** debounce por defecto antes de `git sync` pasa de **2 s** a **45 s** (menos presión al remoto cuando el editor guarda en ráfaga); variable opcional **`OBSIDIAN_MEMORY_DEBOUNCE`** (duración estilo Go, p. ej. `90s`, `2m`; mín. 5 s, máx. 15 m).
- **Windows (`windows-scheduled-vault-sync*.md`, guías relacionadas, ADR-0004/0012, FAQ, glossary, troubleshooting):** texto alineado con sync “profesional” y juego (`windows-juego-vault-sync*`).
- **`README.md` / `README.en.md` / `docs/README.md`:** Windows console + gaming guides; existing-vault merge hint for `create-obsidian-memory`.
- **Onboarding v2-only:** `README.md` / `README.en.md` and `GETTING_STARTED*.md` no longer link migration paths; stubs `PROMPT_ULTRA_COMPLETO.{linux,macos}.md` point only at v2 entrypoints. `docs/README.md` and `docs/legacy/README.md` reframed as v2 index + maintainer archive. `AGENTS.md` references updated.
- **`docs/troubleshooting.md`:** enlace a guía Windows sin consola visible; ajustes de workspace Git/SCM más estrictos en `.vscode/settings.json` y plantilla del inicializador.
- **`CONTRIBUTING.md`:** nota sobre defaults de workspace Git.
- **Puerto por defecto Streamable HTTP `basic-memory`:** de **8000** a **8765** en plantilla `config/mcp/basic-memory-streamable-http.json`, guías Windows, smoke tests y enlaces README; criterio documentado en **ADR-0016** (evitar choque con otras apps en 8000/8080/3000; mismo puerto en listener y `mcp.json`).
- **Onboarding Cursor:** `docs/cursor-memory-setup*.md` — tabla “flujo recomendado”, Paso 1 con **stdio vs URL** (`fetch failed` enlazado a troubleshooting + guía always-on); bloque **User Rules** ampliado (`memory://` vs vault, stdio vs URL HTTP, ruido stderr). `README*.md` — pasos 4–7 (smoke Windows, autosync). `how-memory-works-simple*.md` — distinción `memory://`. `docs/troubleshooting.md` — entradas `streamableHttp` / `fetch failed` y toast `memory://`. `AGENTS.md` (autogen) — transporte HTTP opcional en `.agents/rules/00-stack.md`.
- **Windows sin flash de consola:** guías `windows-scheduled-vault-sync*` y `windows-basic-memory-always-on*` + troubleshooting; `obsidian-memoryd` con `go build -ldflags="-H windowsgui"` cuando aplica.
- **Onboarding lineal:** `README.md` / `README.en.md` son un hub corto: primero `GETTING_STARTED*.md`, luego `docs/how-memory-works-simple*.md`, Cursor, comprobaciones y troubleshooting; `docs/testing/manual-checks.md` y guías Cursor enlazan al mismo flujo.
- CI push trigger: **`main` only** (removed legacy `v2-migration` branch after merge).
- `docs/comparison.md` expanded for v2 positioning.
- CI: matrix lint/test/smoke (`mcp-smoke`, `gitleaks`, `promptfoo` adherence gate).

## [1.1.0] - 2026-05-13

### Added

- `Vault-Doctor.ps1` embedded in `PROMPT_ULTRA_COMPLETO.md` (section 8.8): vault content audit (sizes, duplicate H2, empty dirs, YAML frontmatter coverage, wikilinks, secret-like patterns, scheduled-task launchers, `.gitignore`, stale root installer files). Optional `-WriteReview` writes `REVIEW_YYYY-MM-DD.md`.
- Default vault scaffold from setup: `START_HERE.md`, `TAGS.md`, `KNOWN_FAILURES.md`, `RULES/.gitkeep`, root `.gitignore`, `PROJECTS/_index.md`, and frontmatter on generated Markdown. `SNIPPETS/` removed from the default scaffold.
- ADR-0008 (Vault-Doctor alongside Doctor) and ADR-0009 (frontmatter + three-level reading flow).
- Example vault files: `examples/START_HERE.md`, `examples/TAGS.md`, `examples/KNOWN_FAILURES.md`, `examples/RULES/.gitkeep`, `examples/.gitignore`.

### Changed

- Section 9 User Rules in the prompt: three-level flow (START_HERE → MEMORY + PROJECTS → on-demand RULES/SPRINTS/RUNBOOK/KNOWN_FAILURES/TAGS) and maintenance hint for `Vault-Doctor.ps1 -WriteReview`.
- Section 10 validation: run `Vault-Doctor.ps1` after `Doctor.ps1`; document exit semantics (`FAIL` vs `WARN`).
- `Setup-Cursor-Memory.ps1` in the prompt: end-of-setup runs `Vault-Doctor.ps1`; copy list includes `Vault-Doctor.ps1`.
- `README.md` / `README.en.md` prompt version badge to `v1.1.0`.
- `manifest.json` version to `1.1.0`.

## [1.0.0] - 2026-05-13

### Added

- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md` for community health.
- `.github/` directory with issue templates, PR template, and CI workflows (markdown lint, JSON validation, link check, PowerShell extraction + PSScriptAnalyzer).
- `.editorconfig`, `.markdownlint.json`, `.prettierrc`, `.gitignore` for consistent local tooling.
- `docs/adr/` with the four core architecture decisions extracted from the prompt's section 4.
- `docs/troubleshooting.md` as a standalone, indexable troubleshooting guide.
- `docs/faq.md`, `docs/glossary.md`, `docs/comparison.md` for discoverability.
- `examples/` with anonymized sample vault content (`MEMORY.md`, `SESSION_LOG.md`, `PROJECTS/example-app.md`).
- `schema.json` for `manifest.json`, with a real `$id` and `$schema` reference.
- Prompt section 8.8 hardening: pinning of `@smith-and-web/obsidian-mcp-server`, logging via `Start-Transcript`, log rotation guidance, `Uninstall-Cursor-Memory.ps1`, `Repair.ps1`.
- `README.en.md` (English version) and language switcher at the top of `README.md`.
- Badges in `README.md`: license, last commit, prompt version, tested platform.

### Changed

- `manifest.json` now points to the local `schema.json` instead of the `package.json` schema (which was incorrect).
- `manifest.json` adds `version: "1.0.0"`.
- `AGENTS.md` updated to reflect the new repo structure.
- README structure: added "Quality and CI" section, made Windows-only stance explicit, added compatibility matrix.

### Removed

- Empty placeholder directories (`docs/`, `examples/`, `scripts/`, `template/`) that previously confused readers (the README explicitly says "no scripts in this repo" while four empty script-shaped directories sat at the root).

## [0.x] - pre 1.0

Prior history was undocumented and is summarized only in git log. Highlights:

- Initial guide (Spanish) explaining the Cursor + Obsidian MCP + GitHub pattern.
- Rewrite as an exhaustive operational brief (`PROMPT_ULTRA_COMPLETO.md`).
- Trim of the repo to "prompt only, no scripts" model.
- Addition of `AGENTS.md` and `manifest.json` for machine-readable discoverability.
- Seven hardening fixes for real-world install gaps.

[Unreleased]: https://github.com/Vahlame/cursor-obsidian-memory-guide/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Vahlame/cursor-obsidian-memory-guide/releases/tag/v1.1.0
[1.0.0]: https://github.com/Vahlame/cursor-obsidian-memory-guide/releases/tag/v1.0.0
