# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Console windows no longer steal the foreground during a research run (ADR-0078 amendment).**
  5.3.0 removed the flashing caused by `CREATE_NO_WINDOW`; what remained was the launcher's own
  `AllocConsole()` + `ShowWindow(SW_HIDE)`, which is a **race**: conhost creates and activates the
  window asynchronously, so the hide can run before there is anything to hide and the window shows
  up anyway. Measured on Windows 11 with a full-screen game in front, A/B on the same machine with
  the same instrument and the same measured load — **22 obscura fetches in each arm, 120 s each**:

  | launcher                              | foreground steals |
  | ------------------------------------- | ----------------- |
  | `AllocConsole` + `ShowWindow` (5.3.0) | **14**            |
  | console created hidden (this release) | **0**             |

  The pre-fix arm names the culprit in its own output (`image=vkm-runhidden`).
  `vkm-runhidden.exe` now starts its child with
  `CREATE_NEW_CONSOLE` + `SW_HIDE`, so Windows creates that console **already hidden** — there is no
  interval in which it could be seen. A launcher that inherited the user's terminal still passes it
  down untouched.

  Two facts the measurement corrected: every `vkm-runhidden.exe` started by an MCP server creates
  its **own** conhost (it does not inherit the server's), so the "no console to inherit" branch is
  the hot path — once per fetched page; and a synthetic reproducer does **not** reproduce the race
  (20 launcher starts with a sleeping child: 0 steals), which is why the new regression test ships
  with a control batch.

### Added

- **`create-vkm-kit --windows-audit`** — the diagnosis for "why is my screen still being taken
  away". Reports whether every kit-owned hook and MCP server starts through `vkm-runhidden.exe`
  across **Claude** (`settings.json`, `.claude.json`), **Codex** (`config.toml`) and **Cursor**
  (`mcp.json`), and exits 1 when one does not — the fallback to plain `node` is silent by design, so
  a machine that flashes looked identical to one that does not. `--fix` rewires the JSON surfaces
  (a user's own servers and hooks are never touched, and the `basic-memory` version pin survives);
  `--watch <seconds>` measures instead, printing `console_steals` counted from the foreground for
  **both** console window classes (Windows 11 hosts consoles in `CASCADIA_HOSTING_WINDOW_CLASS`,
  which a detector that only knows `ConsoleWindowClass` misses entirely).

- **Foreign-daemon warnings on research results.** The launcher can only protect the tree it
  starts, and Ollama/SearXNG are "start it if it is not already up". When the daemon listening on
  their port has no `vkm-runhidden.exe` in its parent chain, `obscura_research_start` now returns a
  `foreign-daemon` warning naming the image and PID. `VKM_ADOPT_DAEMONS=1` opts into stopping it so
  the next use restarts it under the launcher — off by default, because that kills a process the
  user may have started deliberately.

- **A behavioural test on the `windows-2022` CI leg** (`console_visibility_windows_test.go`): it
  starts twelve real children and counts visible console windows. Everything guarding this defect
  until now was a source grep running on Linux, where a Windows console cannot exist. The test runs
  a control batch **without** the fix first and skips if that control shows no window — an
  environment that cannot observe the defect must not report a pass it did not earn.

## [5.3.0] - 2026-08-01

### Security

- **`@modelcontextprotocol/sdk` 1.29.0 → 1.30.0 closes GHSA-frvp-7c67-39w9**, the
  `@hono/node-server` `serve-static` path traversal this repo documented in 4.7.1 as
  deliberately open. The reason it was open no longer holds: 1.29.0 pinned
  `@hono/node-server ^1.19.9` and the patch is in 2.0.5, so the only escapes were
  downgrading the SDK or overriding outside its declared range. 1.30.0 declares
  `^1.19.9 || ^2.0.5`, so the fix is now a plain resolution — `npm audit` reports **0
  vulnerabilities**, down from 2. `mcp-smoke` passes against the new SDK (23 tools).

### Changed

- Dependency refresh: `fs-extra` 11.4.0, `eslint` 10.8.0, `@types/node` 26.1.2,
  `globals` 17.8.0. **`execa` deliberately stays at 9.6.1**: v10 requires Node 22 (the kit
  supports ≥20, and raising a user's Node floor is the friction this release exists to
  remove) and moves `.unref()`/`.on()` onto `subprocess.nodeChildProcess`, which five call
  sites use. **`typescript` stays at 6.x** — v7 is the native compiler port, a devDependency
  change with no user-visible benefit and real risk. Both are separate, deliberate calls.

- **`prettier` and `markdownlint-cli` are now pinned devDependencies run through
  `npm run format:check` / `npm run md:lint`,** instead of `npx --yes <tool>@<version>` in
  CI only. The old form pinned the version CI used while the repo declared nothing, so a
  contributor running `npx prettier` locally got whatever was latest that day and disagreed
  with CI about which files are clean — a failure that only showed up after pushing.

### Fixed

- **A pinned `OBSCURA_VERSION` bump could never reach an existing user.** The install gate
  was presence-only (`isRunnable(binPath)`), and the baked-in SHA-256 only ever guards a
  DOWNLOAD — which on an upgrade is exactly what stopped happening, so every machine kept
  its old binary through any number of reinstalls. The gate now compares the version the
  installed binary reports, upgrades a stale copy, and — because Windows refuses to replace
  a mapped executable while an agent session holds it — keeps the working old binary when
  the upgrade fails instead of reporting `failed` and unwiring obscura over a transient lock.
  A user-provided `obscura` on PATH is still respected, but only when the kit manages no copy
  of its own; it can no longer mask a stale one.

- **Installing from a CLONE wired every hook and all four MCP servers to bare `node`.**
  `bin/` is gitignored and `files: ["bin"]` only fills it in the published tarball, so the
  documented `--full` path (which needs a checkout for the hybrid MCP) reintroduced the
  flashing consoles ADR-0078/v5 exists to prevent — for the users running from source, who
  are the most likely to hit it. `installRunHidden` now builds the launcher from the checkout
  when Go is available, and says exactly what to install when it is not.

- **Codex hooks always ran through bare `node`**, so Codex kept the console flash Claude Code
  no longer has. The launcher is now threaded into `configureCodexNative` as an INPUT (never
  probed inside the builder — that is the impurity `mcp-merge.mjs` already paid for).

- **`ollama pull` failed on any machine whose ollama daemon was not already running.**
  `ollama --version` exits 0 with the server DOWN, so the version probe was not evidence the
  pull could run: a fresh `winget install`, a server, or any box where the desktop app never
  started left the pull failing with `dial tcp 127.0.0.1:11434` — which the kit reported as
  "network/disk?", pointing the user at the wrong problem. Setup now starts the daemon
  (through the windowless launcher, since ollama's model runners are the case ADR-0078 was
  measured against) and waits for it before pulling.

- **`vkm-runhidden.exe` is now a reproducible build** (`-trimpath`, `-buildvcs=false`,
  `-buildid=`): two builds of identical source were producing different SHA-256s, and
  `uninstallRunHidden` deliberately removes only a byte-identical copy so it never deletes a
  launcher the user built themselves. Harmless while clone installs produced no launcher at
  all — and a teardown that silently leaves the file behind the moment they do.

- **A machine without the Codex CLI was told four times to finish the install by hand.**
  `registerViaCli` could not tell "this CLI is not installed" from "this one command
  failed", so it printed the run-it-yourself command and a paste-ready TOML block once per
  server — for a tool the user does not have. Since `--full` implies `--ide codex,claude`,
  that was the DEFAULT experience for everyone who only uses Claude Code: four failure-
  shaped blocks in an install that succeeded. The CLI is now probed once and skipped in
  one line.

- **On any distro Python (PEP 668), the backend install failed and the advice was to run
  the command that had just failed.** Debian, Ubuntu, Fedora and Homebrew mark the system
  interpreter externally-managed and refuse `pip install` into it — including `--user` —
  so every Linux and macOS user with a distro Python hit an unactionable message. The
  externally-managed case is now detected and answered with the venv recipe plus the
  `OBSIDIAN_MEMORY_PYTHON` variable that points the MCP at it; other failures now print
  the interpreter that was actually used and pip's own last line.

- **The close-ritual reminder never counted `vault_append_file`** — the tool the kit's own
  memory rules prescribe for the close ("Cierre = `vault_append_file` → `SESSION_LOG.md`").
  A session that closed exactly as documented was told three times that it never touched the
  vault, and a guard that fires after the work is done trains the model to ignore it.

## [5.2.0] - 2026-08-01

### Changed

- **`/vkm-design` remastered against its field failures** (it over-triggered, never stated
  an objective, and hallucinated): the trigger description now excludes one-line style
  tweaks; every invocation starts with a mandatory 3-line brief (For / Must do /
  Constraints) plus a tier pick (Micro/Edit/Surface) that ROUTES how much of the skill is
  read — micro-tasks read nothing; and a new "Rigor — what you may NOT invent" section
  makes numbers-from-runs, verified-names-only, no-invented-authorities and NOT-RUN
  honesty hard rules. Rendered-defect audits are routed to `/vkm-ui-judge`, keeping design
  judgment and defect measurement on separate instruments.

- **The effort gate is gone; the effort advisor never interrupts (ADR-0081).** The one-time
  `PreToolUse` deny that ADR-0080 still carried derailed autonomous iteration loops and charged
  a full model turn to deliver advice. `guard-effort-gate.mjs` (same filename and wiring, so
  upgrades reconcile in place on Claude Code and Codex) now has NO code path that emits a
  permission decision: it scores the session's work, persists the `effortLevel` it calls for
  into `~/.claude/settings.json` — in both directions, so simple work makes the next session
  cheap — and tells the user once per session via a `systemMessage` the model never sees (zero
  tokens, zero pauses). Sub-agent exemption, `VKM_EFFORT_GATE=0`, `VKM_EFFORT_ALLOW_HAIKU=1`
  and the opt-in `VKM_EFFORT_APPLY=keys` applier are unchanged.
- **Context diet (ADR-0082): ~800 fewer input tokens on every session-turn prefix.** The
  `memory` and `doctrine` levels of the managed rules block were compressed ~30-40% (es full
  block 9,258 → 6,675 chars) with every load-bearing rule kept verbatim — the phrase gate in
  `memory-rules-budget.test.mjs` proves it — and the `SessionStart` reminders dropped from
  1,335 → 740 chars (es). Budgets and the context-budget baseline were re-cut to the new
  sizes so the diet cannot silently revert.
- The Bash token-saver hook now also matches `BashOutput` (background-command output — same
  log-shaped text, same hard diagnostic-preservation guarantees). `Read`/`Grep`/`WebFetch`
  stay deliberately uncovered: their output is content, not logs.

### Added

- **`/vkm-seo` skill + `scripts/seo-audit.mjs`** — brutal, measurable SEO for websites,
  remastered from a user-provided modern-SEO guide (semantic synonym/variant/location
  coverage, technical foundations, structured data, GEO/AEO visibility in AI search).
  Brief-first with tiered reading like its siblings; the bundled zero-dependency audit
  checks the delivered HTML (metadata windows, noindex traps, canonical, heading
  hierarchy, alt coverage, JSON-LD validity, social cards, hreflang, robots/sitemap for
  live URLs) and the loop is audit → fix by severity → re-audit, with NOT-RUN honesty for
  checks that could not run and a hard rule against invented metrics or promised rankings.

- **`--skills-dir <path>`** — compatibility escape hatch for agents the kit has no `--ide`
  for yet (Kimi Code, opencode, ...): additionally copies the seven skills (markdown +
  portable Node scripts) into any client's skills folder, hash-tracked and idempotent,
  independent of the `--ide` list.

- **Model-epoch awareness (ADR-0083).** Model-specific memory ages the moment the model
  changes ("tuned for opus 4.8" quietly mis-steers opus 5). The `SessionStart` hook now
  compares the session's model against the last one seen and, only on a change, injects
  ONE context line downgrading `_meta/agent-profiles.md` rows and `STACKS/` verdicts to
  hypotheses to re-verify; the profile templates document the same generation-maintenance
  rule. Steady state costs zero. The same ADR records the criteria-based rejection of
  Postgres/pgvector for the memory path (vault = Markdown+git, index = disposable SQLite;
  pgvector pays off orders of magnitude past a personal vault's scale).

- **`/vkm-intake` skill** — task intake before non-trivial execution: restate
  objective/deliverable/non-goals in 3 lines, at most one closed question on ambiguity, an
  inventory of what attached images actually show before interpreting them, and minimal
  context assembly. Kills the "goes off on a tangent / misreads the prompt" failure mode at
  the cheapest possible point.
- **`/vkm-ui-judge` skill + `scripts/ui-audit.mjs`** — measured visual judgment for any GUI,
  routed by stack: web-rendered UIs (incl. Electron, Flutter Web, Blazor) get the bundled
  Playwright audit; native Flutter gets generated `flutter_test` accessibility-guideline
  tests; other native GUIs (Qt/C++, .NET/C#, Python, Java) get a real-screenshot evidence
  loop plus platform scanners (`references/native-guis.md`). For the web route:
  The bundled Playwright audit renders the live page at 3 viewports × light AND dark and
  reports deterministic defects (computed WCAG contrast, invisible-after-theme-flip text,
  horizontal overflow, sub-44px tap targets, missing viewport meta) as `report.json` +
  screenshots; the loop is measure → fix by severity → re-measure, replacing slow
  "visual thinking" that produced mediocre fixes. Static fallback documented for
  environments without a browser.

### Removed

- The empty `tools/` directory (a README pointing at scripts removed in v3).

### Fixed

- `install.mjs`'s summary line, `--help`, READMEs, install docs and `ARCHITECTURE.md` no
  longer describe the ADR-0031 deny-until-reply protocol that stopped existing in 5.1.0;
  ADR-0031's references to the pre-rename package path and a deleted test file were corrected.

- **Codex CLI now receives first-class parity assets.** `--ide codex` and `--full` install the
  four vkm skills under `~/.agents/skills/`, the required-key TOML `vkm-implementer` agent under
  `~/.codex/agents/`, and idempotently merged `SessionStart`, `PreToolUse`, and `PostToolUse`
  handlers in `~/.codex/hooks.json`. New `--codex-hooks` and per-piece opt-outs keep the surface
  independently reversible; update and uninstall are hash-safe and leave user hook entries alone.
- Added [`docs/codex-parity.md`](docs/codex-parity.md) and its Spanish mirror with official-source
  verification, current hook drift, and a Claude Code continuation checklist.

## [5.1.0] - 2026-07-27

The effort gate stops asking and starts deciding, a fifth skill lands, and a first install on
Windows finally applies the fix 5.0.0 shipped for it.

### Fixed

- **A first install registered every MCP server the wrong way.** 5.0.0's headline Windows fix
  routes each server through `vkm-runhidden.exe` so no console window appears — but the installer
  probed for that launcher BEFORE putting it on disk, so on a machine with no `~/.claude/bin` the
  probe failed and all four servers were registered as bare `node`/`uvx`. Only a second run of the
  installer corrected it, which is why the flashing came back for anyone installing fresh.
  `installRunHidden` now runs before anything writes a `command` string, and its return value is
  threaded into the registrations instead of being re-probed. 415 unit tests passed throughout:
  none of them ran the installer. `test/install-launcher-order.test.mjs` now does, into a
  throwaway HOME, and fails on the old ordering.
- **`resolveLauncher()` read the running user's home**, not the home being installed into, which
  is why no test with a temp HOME could observe the decision. It takes the install's `.claude`
  directory now.

### Changed

- **The effort gate decides, persists, and interrupts once**
  ([ADR-0080](docs/adr/0080-the-effort-gate-decides.md)). The old protocol asked the model to
  print an `[!] EFFORT RECOMMENDATION` block and denied every substantive edit until a user reply
  followed it — which wedged four autonomous sessions when the block drifted or `CLAUDE_EFFORT`
  was unset. It now scores the work itself (which files, which paths, how many, how big, and
  which way your own words push the stakes), writes the level it concludes into
  `~/.claude/settings.json` for the next session, and interrupts **at most once**, tracked in a
  sidecar file rather than inferred from a transcript. A session already at the right level costs
  nothing: no write, no output, no pause. It never selects `fable` and never overrides a session
  already on it. Switches: `VKM_EFFORT_GATE=0`, `VKM_EFFORT_ALLOW_HAIKU=1`, `VKM_EFFORT_APPLY=keys`.
- **What a hook can actually do here was measured, not assumed**, and ADR-0080 records it:
  writing `effortLevel` does not move a running session (35 consecutive tool calls kept reporting
  the old level), no hook output field sets model or effort, and on the desktop app Chromium
  accepts keystrokes only while its window is active — so applying it in the background without
  taking the user's foreground is not available. `VKM_EFFORT_APPLY=keys` uses the DevTools
  protocol when the app was started by `scripts/claude-desktop-debug.ps1` (works from any window,
  at the cost of an open local port), and otherwise types only while the Claude window is already
  in front, retrying on later edits when it is not.

### Added

- **`/vkm-verify` — the fifth skill.** Turns "it passed" into "it passed, and it would have
  failed": four questions (did it run, did it cover my change, can it fail, is what I verified
  what ships) plus `scripts/prove-it.mjs`, a negative control that breaks the file on purpose,
  confirms the check goes red, restores it byte-for-byte and re-runs to prove the restore was
  clean — PROVEN / VACUOUS / DIRTY. Built from the failure class most repeated in real logs: a
  green that examined nothing.
- **A skills guide** — [ES](docs/es/guia-de-skills.md) · [EN](docs/en/skills-guide.md): which of
  the five skills fits a situation, which does NOT, the three pairs that get confused, and what
  each costs in context.

## [5.0.0] - 2026-07-27

The refactor release. The product does the same things; almost every file that does them was
rewritten to be smaller, shared, or honest about what it claims. Two headline outcomes: **no
console window appears while the agent works on Windows**, and **every countable claim in the
documentation now matches the code**.

Upgrading takes one command and, on Windows, one ordering rule:
[Migrating from 4.x to 5.0](docs/en/migration-5.0.md) ·
[Migrar de 4.x a 5.0](docs/es/migracion-5.0.md).

Nothing you configured changes. The npm package, the four MCP server ids, the
`mcp__obsidian-memory-hybrid__*` tool names in your own `CLAUDE.md`, `BASIC_MEMORY_HOME`, every
`OBSIDIAN_MEMORY_*` variable and the default vault path are frozen on purpose —
[ADR-0079](docs/adr/0079-naming-and-compatibility-tiers.md) records which names may ever change
and which may not, and why the dangerous ones never will.

### Removed

- **`obsidian-memory-rag bench` (breaking).** 21 lines timing repeated searches with no ground
  truth, so it could report a fast engine returning the wrong notes. `bench-recall` already
  reports p50/p95/mean per query **and** recall, and gates on either via `--assert-p95-ms` (which
  is what CI uses). Nothing invoked `bench`: not CI, not the MCP bridge, not a test. README, both
  glossaries and both observability pages repointed at the command that survives.
- **`docs/assets/bench-results-dark.svg` (breaking if hotlinked).** It and the light chart were
  7,978 bytes each and diffed to zero differences after normalising hex — the same chart twice,
  differing in seven colours. `bench-results.svg` is now theme-aware via `:root` +
  `prefers-color-scheme`, and the three `<picture>`/`<source>` wrappers collapsed to one `<img>`.
  This also removes the class of bug where a regenerated chart updates one theme and forgets the
  other.
- **`logMcpTurn` and the pino dependency** from `packages/obsidian-memory-mcp`. pino defaulted to
  **stdout** — the JSON-RPC channel — so the logger could corrupt the protocol it was meant to
  observe. Status now goes to `console.error`.
- **32 `(new in 3.x)` stamps** from both explainer pages. The changelog is where "when" belongs,
  and it is one click away.

### Added

- **`@vkmikc/vkm-core`**, the private package the suite's duplicated primitives moved into:
  `mcp-result` (`toolHandler`, `asTextResult`, `asErrorResult`, `pkgVersionFrom`, `isEntryPoint`),
  `untrusted` (the prompt-injection scanner, now one UNION of the bilingual pattern sets that had
  drifted apart), and `hidden-console`.
- **`vkm-runhidden.exe` ships inside the npm package.** It previously existed only on a machine
  that had built it from source with Go, so the console fix could not reach an `npx` install at
  all. The installer now puts it in place **before** it writes any hook entry.
- **`npm run adr:check`**, wired into the CI lint job. Fails on an ADR with no index row, an index
  row whose file is gone, or a supersession declared on only one side. 79 ADRs, all indexed,
  reciprocal.
- **`evals/lib/bench-cli.mjs`** — the one CLI all six live-LLM benches run on, replacing six
  private copies of the same three modes.
- **`packages/create-vkm-kit/templates/vault/{es,en}/`** — the scaffolded vault as 22 real files
  instead of 206 lines of bilingual Markdown embedded in the installer.
- **`templates/skills/vkm-design/scripts/raster.mjs`** — the mask geometry `trace-svg.mjs` and
  `treat-photo.mjs` each carried a private copy of, now pure, shared and tested.
- **A migration guide, in both languages** ([EN](docs/en/migration-5.0.md) ·
  [ES](docs/es/migracion-5.0.md)).

### Changed

- **`docs/observability.md` moved to `docs/en/observability.md`.** It was the only English page not
  under `docs/en/`, so its Spanish mirror `docs/es/observabilidad.md` was the only one whose
  language switcher pointed out of the language directories. Every live reference was repointed
  (both root READMEs, `ARCHITECTURE.md`, both glossaries, `docs/README.md`,
  `docs/security/README.md`, ADR-0015, `packages/vkm-doctor/README.md` and two source comments);
  the mentions in this changelog's own history are left as they were, because they describe what
  was true in the release they document.
- **The installer is one path, not two.** `src/index.js` went from 1,839 lines to 446: the wizard
  and the headless flow now both end in the same `runInstall` + `printSummary`, with option
  resolution as a pure `resolveOptions(argv, ctx)` returning ~25 toggles. Before this, a flag could
  reach `-y` and miss the wizard's work — the two flows had drifted into doing different things.
- **The Go daemon is split by responsibility.** `cmd/obsidian-memoryd/main.go` went from 950 lines
  to 91, alongside `cli.go`, `runner.go`, `gitsync.go`, `doctor.go`, `watch.go`, `service.go` and
  `logs.go` — the split the existing tests already implied.
- **The eval benches share a stream contract (breaking for scripts):** stdout is JSONL rows,
  stderr is the human report, in all six. Five already did this; `token-quality-ab` did the
  reverse. CI's `| tee` steps became `2>&1 | tee`, so an artifact now holds rows **and** summary —
  previously three held rows with no summary and one a summary with no rows.
- **`discipline-bench` lists its conditions treatment-first (breaking for scripts).** It was the
  only bench whose delta carried the opposite sign to its siblings. Condition values are unchanged;
  the order and the delta's sign flipped.
- **Bench reports go through `evals/lib/stats.mjs`.** ADR-0064 described it as "shared by every
  bench runner"; it had zero production importers. `MIN_N`, the seeded bootstrap CI and the
  bold-only-when-earned rule now decide every printed delta, so a bench cannot emphasise a result
  off n=2 however large it looks. Re-grading the committed design-bench answers, a +45.0 with a
  perfect Cliff's delta prints as _directional_ because n=4.
- **Bench cost reaches the report.** `runSubject` has returned per-run token counts since ADR-0065
  and all six callers dropped them. Cells now print what they spent next to what they scored, and
  the delta line carries the token delta and points-per-1k-tokens.
- **Both FAQs stopped promising the index "keeps search fast at any size."** ADR-0069 says the
  opposite in as many words, and `ARCHITECTURE.md` already answered honestly. They now say what is
  measured, what is extrapolation, and what a real measurement would be worth.
- **Hard-coded counts deleted rather than corrected** across the architecture docs and both
  READMEs ("fifteen tools" when 22 register, "eight tools" when 11 do, "(0001–0056)" against 79
  ADRs, three skills named when four ship). A hard-coded total is wrong again the next time
  something lands; `skill-count-drift.test.mjs` and `tool-doc-drift.test.mjs` derive theirs from
  the code.
- **`SECURITY.md` has a "Past advisories" table.** It read "None yet" two sections below its own
  citation of `docs/security/mcp-remote-rce.md` as a hard constraint.
- **`CHANGELOG.md` split.** 3.15.0 and older moved verbatim, with their footer link definitions,
  to [`docs/changelog/pre-4.0.md`](docs/changelog/pre-4.0.md); this file dropped from 2,767 lines
  to under 2,000. Verified safe before the move: `version.mjs` matches only the FIRST `## [X.Y.Z]`
  heading and `release.yml` extracts only the section for the tag being published, so both always
  read the root file.
- **`design-bench/RESULTS.md` is 48 lines, not 502.** Twenty-one chronological run notes from one
  day moved to `diary-2026-07-12.md`; the findings and the limits are no longer buried between
  them.
- **`scripts/version.mjs` and `scripts/license-sync.mjs` derive the package list from
  `packages/*`** instead of a literal table that only encoded which packages existed the day it was
  written.
- **The obscura, RAG and vault layers lost their duplicate implementations**: one job registry
  across the crawl/research/fetch jobs, one Ollama transport (`embedPassages` 90 lines to 28, and
  it recovered the `MIN_OLLAMA_VERSION` health gate it had silently lost), one `#tag` definition
  where three regexes disagreed, one wikilink parser.

### Fixed

- **No console window flashes while the agent works on Windows — and now that fix actually reaches
  you.** Every vkm hook is a Node script and the agent host starts one process per matching event;
  two of them fire on every `Bash` call and every MCP call, so a research run spawns hundreds of
  `node.exe` — a CONSOLE-subsystem binary Windows gives a real window that appears, **takes the
  foreground**, and vanishes. The counter-intuitive part is that the obvious protection causes it:
  `CREATE_NO_WINDOW` leaves the child with no console, and a console-subsystem _grandchild_ whose
  parent has none gets a brand new **visible** one (measured against ollama's model runner, one per
  model load). `vkm-runhidden.exe` fixes it from the other end — GUI-subsystem, so the loader gives
  it nothing; it allocates a console, hides it, and starts the target so the whole tree inherits
  that one hidden console. stdin, stdout and the **exit code** are proxied verbatim, so a
  `PreToolUse` guard can still block a tool call ([ADR-0078](docs/adr/0078-allocate-and-hide-a-console.md)).
- **The MCP servers were themselves the console windows.** Measuring with
  `Get-CimInstance Win32_Process` found a `conhost.exe` as a **direct child** of every kit MCP
  server — four servers times four open sessions, sixteen processes and sixteen consoles — because
  they were registered as `command: "node"` / `command: "uvx"`. They now launch through
  `vkm-runhidden`.
- **The launcher no longer orphans its child.** Routing the sidecars through it made one client's
  timeout test run **1,000,210 ms**; a Windows Job Object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` brought that to **932 ms**.
- **The launcher no longer hides the terminal you started it from.** It hid whatever console was
  present, including an inherited one — and `ShowWindow(SW_HIDE)` has no undo here, so running it
  from PowerShell left that shell alive with no window, recoverable only via Task Manager. It now
  hides only a console it allocated itself.
- **The installer says so when a running session blocks the launcher upgrade,** instead of
  reporting success over a half-applied install.
- **The `PreToolUse` effort gate was still wired to bare `node`, so it kept flashing.** Its hook
  entry was the one of four that was never handed the resolved interpreter. The telemetry sink and
  both token-saver hooks had the mirror-image defect: they resolved the interpreter _inside_ the
  factory, against the current user's `~/.claude`, which is not necessarily the home being
  installed into. All five now take it as a parameter resolved once at their composition root.
- **Twelve scripts silently did nothing when run on Windows.** Their entry-point guard compared
  `import.meta.url` with a `file://` string built from `process.argv[1]`, which never matches a
  Windows path (backslashes, no `/C:/` prefix): `main()` was skipped and the process exited 0 with
  no output — indistinguishable from a real pass, including for the CI steps that run
  `scripts/harness-matrix.mjs` and `evals/lib/arm-install.mjs`. All now use `pathToFileURL`, and an
  ESLint rule fails the build if the broken shape reappears.
- **Two eval benches could not run on Windows at all.** `await import(path.join(...))` throws
  `ERR_UNSUPPORTED_ESM_URL_SCHEME` because Node reads `c:` as a URL scheme, so
  `token-quality-ab --mechanism <anything>` crashed on every invocation and `design-bench --grade`
  crashed in its grader. Both go through `pathToFileURL().href`.
- **`largestComponent` returned the WHOLE FRAME for an empty mask** in the vkm-design image
  scripts: with nothing labelled, the final `label[i] === best` test read `0 === 0` for every
  background pixel. A threshold that found no subject reported the entire image as one, and
  `--cutout` kept everything. Present in both private copies of the function, and untestable where
  they lived.
- **`treat-photo --shadow "#zz"` painted with `[NaN, NaN, NaN]`.** Its private hex parser accepted
  anything; it now uses `contrast.mjs`'s `parseHex`, which throws with the offending string.
- **A research topic's content is indexed once, not twice.** `compiled-sources.md` is the verbatim
  concatenation of every `RESEARCH/<topic>/sources/*.md`, so indexing it stored each passage a
  second time, competing with its own original in BM25 and in the vector index. It is now skipped
  by both the indexer and the audit (which must see exactly what retrieval sees). No recall is
  lost: every passage stays retrievable through the source note it came from, which also carries
  the `url`/`author`/`retrieved` frontmatter the merged file flattens away.
- **`obscura-web`'s URL identity is real** — the same page keeps one identity, rather than getting
  two entries for a trailing slash.
- **`packages/obscura-web/src/robots.mjs` had been reduced to a stub** with 11 tests skipped
  around it. The real implementation is restored and all 17 pass.
- **ADR-0055 said "Accepted"** while ADR-0057, four days newer, declared it had superseded two of
  its sections. A reader landing on 0055 acted on a reversed decision. Both rows carry it now, and
  `adr:check` fails on a one-sided supersession.
- **`README.en.md` carried Spanish alt text** on the benchmark chart: an English screen-reader user
  was read Spanish.
- **`hero.svg` said "Suite de eficiencia 4.x"**, so the hero image of a 5.0 release would have said
  4.x on day one. The version is gone and a test keeps it out.

### Verified

The ranking path is the one thing a refactor of this size must not move. All four bench gates were
re-run and **diffed against their pre-refactor output**, not merely re-checked against a threshold:
retrieval recall@5 1.000 / MRR 0.986 / hit@1 0.971 / nDCG 0.989 / MAP 0.986; tokens 100% answered
with wire median 37%; assemble 100% answered — identical. All 72 committed bench scores across four
result sets re-grade identically through the new driver.

Suites at this commit: **248 pytest** and **1,269 Node tests, 0 failures** — create-vkm-kit 414,
obscura-web 474, obsidian-memory-mcp 164, vkm-core 52, vkm-downloads 59, vkm-spec 49, vkm-doctor 12,
eval libraries 45. Plus `go vet`, `go test`, and builds for linux/amd64, darwin/arm64 and
windows/amd64; ruff, eslint, tsc, prettier (at the pinned 3.8.4), markdownlint, linkcheck over 1,060
files, `adr:check` over 79 ADRs, `version:check`, `sync-agents:check` and `license:sync:check`.

## [4.7.1] - 2026-07-25

**What changes for you when you update.** Nothing in the installed contract — no new tool, no new
parameter, no behaviour change. Housekeeping: the front page now answers "what is this and how do I
start" on the first screen instead of the fifth, the release process can no longer ship a lockfile
naming a previous version, and two dependency advisories are closed.

### Changed

- **The README leads with the promise and a three-step start, not with the architecture.** The
  landing page opened with theory — what MCP is, how information flows, a ten-row component table,
  the measured token economy, ADR references — with every paragraph duplicated inline in Spanish and
  English even though a full English README already exists one link away. A reader deciding in
  thirty seconds whether this is for them had to parse an engineering document first, and the
  visible surface (`doctor`, `spec`, `obscura`, `downloads`, `research`, `hybrid`, `rag`, `daemon`,
  `graph`, `telemetry`) made a one-command install look like an ecosystem migration. The first
  screen is now the promise in one sentence, then **install → restart → ask it one question**, then
  an explicit "that is everything you need to get started". `--full`, the agent-driven install, the
  update flow, the component table and the benchmark wall moved behind `<details>`, and the inline
  bilingual duplication at the top is gone (the language switcher stays). No content was deleted and
  every link still resolves — what changed is disclosure order.

### Fixed

- **`package-lock.json` is a version marker now, so a stale lock cannot ship**
  (ADR-0077). `version:set` rewrote 13 markers and left the lockfile out, and
  `version:check` never read it — so **4.6.0 and 4.7.0 both shipped with every workspace
  recorded at 4.5.1 in the lock** while every `package.json`, badge, `agent.toml`,
  `pyproject.toml` and the Go daemon said otherwise. Nothing failed loudly because
  `npm ci` installs a workspace from its own `package.json` and never compares it with
  the lock's copy (measured: `npm ci --dry-run` exits 0 against the drifted lock). `set`
  now rewrites each workspace's lock entry — a replace scoped to that entry, so a bump is
  7 changed lines and never a whole-file reformat — and `check` surveys them: **20
  markers, up from 13**. A lock entry for a workspace with no marker is reported too,
  which closes the older hole where a package added without markers drifted unseen
  everywhere.

  **Nothing about the published packages changes.** npm packs the version from
  `package.json`, so no release was ever mis-versioned; what was wrong is the repo's own
  record of what it released.

- **The `.claude` directory is now ignored by eslint and markdownlint.** It holds the agent
  worktrees — full nested checkouts of this same repo — so locally both linters reported every file
  once per live worktree and failed on half-written code from an unrelated branch. CI never saw it
  (the directory is gitignored), so local and CI disagreed about what a clean tree is; now they
  don't.

### Security

- **Two high-severity advisories in transitive dependencies closed** (both build-time, neither
  reachable from a running install): `brace-expansion` 5.0.7 → 5.0.8 (unbounded expansion → an
  out-of-memory crash; reached only via `eslint → minimatch`) and `fast-uri` 3.1.2 → 3.1.4 (host
  confusion via a literal backslash authority delimiter; reached via
  `@modelcontextprotocol/sdk → ajv`). `@hono/node-server`'s `serve-static` Windows path traversal
  (GHSA-frvp-7c67-39w9, moderate) stays **open and documented**: the patch lands in 2.0.5 while
  `@modelcontextprotocol/sdk@1.29.0` — the newest published SDK — pins `^1.19.9`, so npm's only
  offers are downgrading the SDK to 1.24.3 or overriding a major outside its declared range, which
  would risk breaking the Streamable-HTTP transport in a path no test here covers. The kit never
  imports it: every HTTP server in this repo is `http.createServer` bound to `127.0.0.1`, and the MCP
  servers speak stdio. Revisit when the SDK bumps.

## [4.7.0] - 2026-07-25

**What changes for you when you update.** This release is almost entirely _measurement_: six
questions about how the kit's memory behaves were asked with a falsifiable prediction written
first, and **five of them ended in "do not build that"**. Only one behaviour actually changes:

1. **A superseded decision no longer outranks its replacement.** If your vault records
   `- supersedes [[old-note]]`, search now returns the current decision above the obsolete one.
   Turning on `graph: true` used to make the _wrong_ answer deterministic — the edge lives in the
   new note, so the new note became a graph seed and the old note collected the boost. Measured
   5/5 obsolete-first before, 0/5 after. A strict no-op if your vault does not use the relation.
2. **Search hits carry `why` instead of `score`** (from 4.6.0's line of work, shipped here):
   each hit says which rankers matched it — `lex+sem`, `sem`, `graph`. A `sem`-only hit on a query
   naming an exact identifier means the literal token was never found, so `vault_fts_search` is
   the better next call. The old fused score said nothing the result order did not (measured: 380
   hits, 0 cases where it rose as rank fell) and moved behind `explain: true`.
3. **The default `limit` stays at 10.** The case for lowering it rested on a benchmark that could
   not fail — 7 notes, ground truths of at most 2. On 74 real notes, k=5 answers 13% of
   multi-note questions where k=10 answers 60%. Your `limit: 3-5` habit for looking up one known
   fact is still right; that is a different question shape.

Nothing else in your install changes. No new tool, no new parameter, no schema characters, and
no migration.

### Added

- **Confidence in ranking: measured and closed** (ADR-0076). The doctrine asks the model to mark
  hypotheses (`status: hypothesis`), but retrieval never consulted it. Five topics, each with a
  hypothesis note and a confirmed note: with natural hedged wording the confirmed note wins 4/5 —
  reassuring, and an artifact of the fixtures' prose. Rephrase the hypothesis to match the query
  and it wins **5/5** while declaring itself unconfirmed. No fix ships: a tie-break needs to pair
  two notes with no relation between them (the semantic-duplicate problem already killed by
  measurement), and surfacing `status` on the hit needs an index-schema migration, since
  frontmatter is not indexed at all. The gap is documented rather than papered over.
- **Cross-project leakage probe** (`evals/cross-project/probe.py`, ADR-0074) — a proposed
  `project:` filter was closed by measurement instead of code. The headline 92% leak rate at
  k=5/k=10 is a density artifact (the semantic pass makes every note a candidate, and k=10 on a
  19-note corpus is half the vault); the number that costs an agent anything is the **top-3: 4
  hits, all the same note**. Three of those four arrive `why: "sem"` — already flagged by the
  provenance label from ADR-0072, on a question it was not designed for. Whether the leak
  survives a **neural** embedder is the decisive test and cannot run in blocking CI (~100 MB
  model), so the probe takes `--embedder` and runs both arms in `nightly-benchmarks.yml`.
  No tool, no parameter, no schema characters.
- **`evals/limit/` — a bench that can say no** (ADR-0073). The case for lowering the search
  `limit` below 10 rested on `evals/tokens/` reporting 100% answered at k=3 — but that corpus is
  7 notes with ground truths of at most 2, so every `k >= 2` passes its completeness gate by
  construction. On 74 real ADRs with 3-6 note ground truths, **k=5 answers 13% of multi-note
  queries where k=10 answers 60%**, and k=10 also saves more, because a query that fails the
  completeness gate contributes no savings at all. **The default stays at 10** — no code changed.
  The doctrine's `limit: 3-5` advice for targeted single-fact recall is unaffected and still
  correct; the two are different query shapes.
- A **truncation signal** for the search envelope was designed, measured and **rejected**
  (ADR-0072): it would fire on 100% of queries in both eval corpora, because the semantic pass
  is dense and makes the candidate pool the whole vault. Recorded so it is not re-proposed.
- **Verified bench arms** (`evals/lib/arm-install.mjs`, ADR-0071) — installs the kit into a
  throwaway HOME with a declared subset of the fixed layer and **throws if the subset did not
  land**. Five arms: `off` (control, no install), `core`, `standard`, `rules-full`, `full`.
  Unblocks WP1, the off-target control ADR-0063 deferred before turning the measured fixed layer
  into a budget. The trap it closes is executed as a test: an arm built from `e2e-smoke`'s
  `--minimal --no-skills --no-agents` flags and labelled a full install must fail the build,
  because that subject is missing the layer under test. Runs on every push in `e2e-smoke`.
- All ADRs from 0062 to 0071 added to the `docs/adr/README.md` index, which had drifted nine
  entries behind.

### Fixed

- **A superseded decision could outrank its replacement** (ADR-0075). The `- supersedes [[old]]`
  edge is authored in the **new** note, so the new note became a graph seed and the **obsolete**
  note collected the neighbour boost. Measured on five independent supersession pairs: with
  `graph: true` the obsolete decision ranked first **5/5**; with the graph off, 3/5 — ranking had
  no notion of currency at all. `hybrid_search` now orders each superseding note above the note
  it supersedes, before the cut to `limit`. Obsolete-first is now **0/5** in every configuration.
  Membership-preserving (the old note is still returned, one position lower, so ADR-0027's
  navigation case survives) and a strict no-op on vaults with no `supersedes` relations — the
  token bench wire total is byte-identical at 11,810 and `recall@5` stays 1.000.

### Changed

- **`vault_hybrid_search` hits now carry `why` instead of `score`** (ADR-0072) — which
  rankers matched (`lex+sem`, `sem`, `graph`) replaces the rounded RRF score in the default
  payload. The score was measured to be monotone with hit position (380 hits, 0 violations),
  so it said nothing the result order did not; `why` is not recoverable from order and is
  actionable — a `sem`-only hit on a query naming an exact identifier means the literal token
  was never found, so `vault_fts_search` is the better next call. The score moves behind
  `explain: true` alongside the other diagnostics. Anything parsing `hit.score` from a default
  response must read it from `explain` instead.

## [4.6.0] - 2026-07-25

**What changes for you when you update.** This release is the first output of a measurement
programme rather than a feature drop: the kit's fixed per-session cost was measured for the first
time, the rules block was split so it can be turned down, and several long-standing defects were
found by instrumenting things nobody had instrumented. Four changes you will actually notice:

1. **The rules block is rewritten in place** across all four surfaces (`AGENTS.md`,
   `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `.cursor/rules/`). Same protection, regrouped into
   `core` / `memory` / `doctrine`, plus a new **arbitration rule** that settles what wins when the
   block, a skill and your own request disagree: your preferences and the current chat beat every
   rule here; brevity belongs to the prose and never to the code; low stakes → decide and proceed,
   medium or high → ask before assuming.
2. **`/vkm-discipline` no longer auto-fires** on explanation, non-technical writing, chat/log
   recaps, diagrams, web research, or a decision you reserved for yourself. It stays fully available
   by invoking it explicitly. This is the most visible day-to-day change.
3. **New `--rules-profile minimal | standard | full`** (default `full`, unchanged behaviour).
   `minimal` is a documented kill switch at **16% of the block's size** for when the kit's style is
   getting in your way.
4. **`vault_edit_file` no longer writes mixed line endings** into CRLF notes — a real data-quality
   fix for anyone whose vault came from Windows or Obsidian.

**Honest framing:** the behavioural changes in (1) and (2) are **predicted, not yet measured**. The
instruments to measure them were built in this release; the runs come next. Every claim carries a
falsifiable prediction in its ADR rather than a number nobody checked.

### Fixed

- **The audit measured a different vault than search does** (ADR-0070) — `indexer._should_skip_dir`
  skips **any** dot-directory; the audit excluded only three by name. `vault_delete_file`
  soft-deletes into `.trash/` **inside the vault**, so trashed notes counted toward the token
  budget, appeared in `oversized`, and had their `[[wikilinks]]` scanned — reporting on notes
  retrieval can never return. It also produced **false `index_drift`** (reproduced live:
  `drift_total: 1` from one soft-deleted note). The audit now applies the indexer's rule, fixed at
  the root rather than by special-casing `.trash`. _The working hypothesis was the opposite and
  stronger — that soft-deleted notes stay searchable. An empirical probe refuted it; only the probe
  told the two apart._
- **Two sources of truth for the default search limit** (ADR-0070) — `DEFAULT_SEARCH_LIMIT` is
  derived from `VKM_DEFAULT_LIMIT` (ADR-0034's A/B lever) and used in both schema defaults, then
  contradicted by a hardcoded `String(limit ?? 10)` in both handlers. Harmless today because the
  schema default always populates `limit`; a lie that would silently ignore the lever the moment
  that default moved. Both now read the constant.

- **`vault_edit_file` no longer writes mixed line endings** (ADR-0070) — `vaultAppendFile` has always
  normalized its chunk to the file's own EOL; `vaultEditFile` spliced `newText` in raw. Vault notes
  are commonly **CRLF** (the shipped doctrine says so, and tells the model to anchor each edit on ONE
  single line precisely because of it) while a model composes `newText` with LF, so the same content
  produced a clean note through one tool and a mixed-ending note through the other — which then
  breaks the single-line anchoring that rule exists to protect, and noises every later git diff. Both
  paths now share one `toFileEol()` helper, because the bug _was_ the drift. Single-line `newText` is
  byte-identical to before. Pinned by 4 tests **verified to fail without the fix** (2 of 64).
- **obscura-web: `obscura_research_start` no longer dies on engine rate-limits**
  (observed live: job `deep-mrvnd4nz-e30773d5` ended `failed` at 3.7 min of a
  30-min budget after 3 consecutive search errors, 4 of 6 seeds unresearched,
  7 `pendingLeads` dropped; second occurrence after
  `RESEARCH/winoptengine-go-to-market`). Root cause was the scheduler, not the
  crawl: `MAX_CONSECUTIVE_ERRORS = 3` turned a transient SearXNG suspension
  (`suspended_times`: 180s–3600s) into a fatal job state, discarding the failed
  seed and the whole remaining budget, and surfacing serp.mjs's interactive
  "Fall back to the native WebSearch tool" advice as the background job's cause
  of death. The scheduler now treats suspension as weather: failed/banned
  queries re-enqueue at the END of the frontier (bounded `MAX_ITEM_ATTEMPTS`,
  never silently dropped — leftovers land in `abandonedQueries` and the run
  report); a streak of suspicious rounds parks the job in a global exponential
  cooldown (`cooldown_ms` param / `OBSCURA_DEEP_COOLDOWN_MS`, default 2 min,
  doubling to a 10-min cap, zero upstream requests while waiting, visible as
  `cooldownUntil` in `obscura_research_status`, stop-responsive in 5s slices);
  and the final state is honest: `failed` ONLY when not one useful round was
  banked, `done-partial` when useful rounds exist but work remains (listed as
  resumable — the report's "Unexplored leads"/"Abandoned after retries" plus a
  Resume hint), `budgetUnusedMs` reported so an early death can never masquerade
  as a spent budget again. No extra request volume anywhere — the fix only ever
  waits longer and retries later (ADR-0057's one-job/ban constraint intact).
  Covered by `test/deep-research-resilience.test.mjs` (fake clock, no network:
  re-enqueue order, exponential cooldown + visibility, failed-vs-done-partial,
  stop-during-cooldown) plus updated scheduler/MCP suites; 331/331 green.
- **`--update` no longer deletes assets other kit modules installed** (ADR-0061
  amendment). The sidecar manifest (`~/.claude/vkm-kit.assets.json`) is shared by every
  hash-tracked asset — skills/agents AND the token-saver's `vkm-terse` output style —
  but `--update`'s plan only enumerated skills+agents, so the orphan sweep read the
  live, active `~/.claude/output-styles/vkm-terse.md` as "recorded but no longer
  shipped" and removed it. `buildUpdatePlan` now takes `managedRoots` (the documented
  `~/.claude/skills/` + `~/.claude/agents/` scope, passed by both `--check-update` and
  `--update`); sidecar entries outside those roots are omitted from the plan entirely.
  Regression tests cover the scoped sweep and the exact token-saver reproduction.

### Changed

- **The close ritual now names `vault_append_file` for the `SESSION_LOG` one-liner** (ADR-0070) — the
  rules block said _"Close = `vault_edit_file`/`vault_write_file` → `SESSION_LOG.md` (1 line at the
  end)"_ and never mentioned the tool whose own description calls it _"the CRLF-aware append — the
  SESSION_LOG one-liner path, no anchor round-trip"_. The most frequent write in the whole protocol
  was routed through the path that needs a unique anchor. `vault_edit_file`/`vault_write_file` stay
  for the incremental `PROJECTS` write, which genuinely needs positioning.
- **`vkm-discipline` no longer contradicts itself** (ADR-0070) — step 5 mandates the bundled
  evidence-gate runner; the guardrails section 54 lines later called evidence gates _"modules you
  wire when you want them, off by default"_. It now states the three guardrails that actually ship
  (the ADR-0067 stakes ladder, the bundled gate runner, the untrusted-data envelope +
  `domains/security.md`) and confines "opt-in" to everything beyond them. **No capability claim
  attached** — no bench scores "did it pick the cheaper write path" or "did it ask at high stakes",
  so a number here would be invented.
- **`vkm-discipline`'s trigger narrowed, and "deliver more than asked" made conditional** (ADR-0068).
  The skill advertised itself as firing on _"any non-trivial task — coding, debugging, data, infra,
  writing, review"_, which is why it reached explanation, non-technical writing, summarisation and
  decisions that are the user's — task types where its own contract (_"deliver more than asked"_,
  _"no two approaches"_) is actively wrong. The description is now noun-anchored with explicit
  negatives (one-line edits, questions, explainers, chat/log recaps, diagrams, web research, options
  or scope the user reserved), `Deliver more than asked` is conditional on the user not having
  scoped the request and defers to the ADR-0067 arbitration rule, and the domain table is documented
  as deliberately wider than the trigger (every domain stays reachable via explicit
  `/vkm-discipline`). `evals/skills-triggering/cases.jsonl` grows 64 → 72 with negatives for exactly
  what the narrowing must hold: two explicit "give me options, I decide" cases, a fenced scope, a
  review whose right answer is "no changes needed", non-technical writing, an explainer and an
  opinion. **Predicted, not measured** — the bench must be re-run at more than one model tier before
  any claim, since the failure mode here is model-dependent clause anchoring.
- **Every pre-existing `RESULTS.md` re-labelled against the ADR-0064 reporting rule** — each bench
  gains a banner stating the standard, and its under-powered deltas are re-labelled `directional`.
  **No measurement changed**; only the weight placed on it. `implementer-bench` needed no change (it
  already declined to claim a verdict at n=3) and `token-quality-ab`'s n=9 round keeps its weight.
- **`obscura_search` / `obscura_research` scrape-chain now rotates across many engines**
  (ADR-0051 amendment). `DEFAULT_CHAIN` went from DuckDuckGo-only to
  `duckduckgo → bing → brave → mojeek → marginalia → ecosia → bing-rss`: when one engine is
  banned/empty the next is tried, and the native-fallback signal fires only after **all** fail —
  previously a single DuckDuckGo rate-limit fell straight to native, which is what stopped
  deep-research jobs mid-run (`scanned:0` → `engines_suspended`). The new engines
  (`mojeek`/`marginalia`/`ecosia`; `startpage` env-only) are **generic-extraction** engines: no
  bespoke HTML parser, their SERP is scraped by the existing similarity-ranked `genericExtractLinks`,
  so each costs only a search-URL pattern instead of a drift-prone per-engine parser (their URL
  patterns are best-effort/unverified — a wrong one returns nothing and the chain rotates on).
  `bing-rss` stays last as the never-rate-limited structured-XML last resort;
  `OBSCURA_SEARCH_ENGINES` still overrides per-machine. For the widest, most relevant many-engine
  (incl. regional / non-English) search, **SearXNG** (Layer 1, ~100 upstream-maintained engines)
  remains the primary mechanism. Four tests added to `test/serp.test.mjs` (two rotation, two
  generic-engine).
- **`obscura_search` now translates a non-English query to English before searching** (`translate`,
  default on; ADR-0051 amendment). Primary technical sources are in English, so this surfaces them —
  the light half of what `obscura_research`'s query expansion already does. Gated by a cheap
  heuristic (an English-looking query skips the model call entirely) and an enhancement-not-dependency
  (Ollama down / any failure → the original query is searched, never an error); the response carries
  `translatedFrom` when a translation happened. The LLM still answers the user in their own language;
  only the search is lifted to English. `translate: false` searches verbatim. New `translateQuery` +
  `looksNonEnglish` in `ollama-client.mjs` (uses `OBSCURA_OLLAMA_EXPAND_MODEL`, no new model to pull);
  nine tests added.

### Added

- **`vault_audit` now reports `index_drift`** (ADR-0069) — Markdown is this system's single source of
  truth and the SQLite index is rebuilt from it, but incremental indexing keys each note on
  `(mtime_ns, size_bytes)` and **cannot see an edit that preserves both** (a `git checkout` that
  restores an mtime, a two-character swap inside one filesystem tick, a restored backup); a note
  deleted outside an indexing pass also leaves its row behind. In a memory system that is worse than
  a missing index — a missing index fails loudly, a stale one keeps answering from text no longer on
  disk. The audit now reports `missing` / `orphaned` / `stale` counts and names its own fix
  (`vault_fts_index`), and **never applies it**: a report that repairs hides the problem it exists to
  surface, and a test pins that two consecutive audits see the same drift. `None` when there is no
  index (absence is not drift) or when the sidecar is locked/corrupt (not a vault-health finding).
  Costs **zero new tools and zero new parameters** — a result field is free in schema terms, which
  matters with 52 chars of headroom on the ADR-0063 budget gate; the one-line description edit
  overran it by 2 chars and was trimmed to fit rather than the gate being raised (10,790 / 10,800).
- **`ARCHITECTURE.md` answers the standing architectural questions** (ADR-0069) — what the kit is (a
  memory substrate over MCP, not a framework), which representation governs (Markdown,
  structurally — the index is derived and rebuilt from it), how much intelligence belongs in the
  engine versus the model (the measured answer: 45,247 chars of fixed prior, being moved to
  mechanism), whether it works without the skills (yes — `--rules-profile minimal`, 16% of the
  block), **how far it scales (unproven past a few thousand notes; the retrieval bench is 19
  notes)**, whether it self-repairs (it detects and refuses to act, deliberately), and **what the
  global quality metric is (there isn't one — a real gap)**. Several answers are admissions, on
  purpose: an architecture document that only records strengths is marketing.

- **Cost accounting in every bench run** (`evals/lib/subject-runner.mjs`, ADR-0065) — every live-LLM
  bench measured Δquality and none measured what it cost, so "the kit wins by 20 points" and "the kit
  wins by 20 points while spending 3× the tokens" were the same reported result. `runSubject` now
  returns a normalized `cost` (`inputTokens` / `outputTokens` / `cacheRead*` / `totalTokens` /
  `turns` / `costUsd` / `wallClockMs`) and all five runners carry it on their emitted rows — the
  `usage` field was already being returned and every call site dropped it one line later.
  `costEfficiency()` gives the Δquality/Δtokens column (quality per 1,000 extra tokens), and
  `toTelemetryTotals()` re-keys a cell into the exact shape `vkm-doctor` aggregates local OTLP into,
  so lab cost and real-session cost are finally the same units. **Unreported cost stays `null`, never
  `0`** — a partially-reported cell refuses to average rather than quietly reading as cheaper.

- **Shared eval statistics + an executable reporting rule** (`evals/lib/stats.mjs`, ADR-0064) —
  `METHODOLOGY.md` §5 has always prescribed replicas, confidence intervals and effect sizes, and
  nothing in the repo computed any of them; the result was **18 bold deltas across the benches, all
  at n ≤ 3**. The new module provides a seeded (reproducible) bootstrap CI, Cliff's delta with
  magnitude bands, Hedges' g, and `classify()` / `formatDelta()`, which apply the rule: `n < 5` →
  `directional` (never bold), `n ≥ 5` with a CI excluding 0 and clearing a pre-registered ε →
  `significant` (bold), otherwise `inconclusive`. Bold is emitted by code, so it can no longer be
  written by hand off two runs. `evals/` is not an npm workspace, so `npm test --workspaces` never
  covered it — the `lint` job now runs `node --test evals/lib/stats.test.mjs` (pure computation, no
  OS surface, so the deterministic ubuntu job rather than the 3-OS matrix).
- **`--rules-profile minimal | standard | full`: the rules block is now three levels** (ADR-0067).
  The installed block is a **permanent behavioural prior** injected into every session of every
  wired agent, and five of its eight sections were general working style rather than memory
  protocol — unconditional instructions about how to answer _anything_, shipped to someone who
  installed a memory tool. It is now split by what each part earns its place with: **`core`**
  (always, ≤1,200 chars — memory precedence, the untrusted-data boundary, "if no MCP answers, say
  so"), **`memory`** (the protocol proper), **`doctrine`** (terseness, self-check, coaching, model
  adaptation). Default stays `full`; **`minimal` is the documented kill switch — 1,487 chars against
  9,225, an 84% smaller prior** — for when the kit's style is getting in the way. `core` also gains
  an **arbitration rule** that did not exist anywhere before and ends a silent three-way conflict
  between the block, `/vkm-discipline` and the close ritual: your preferences and the current chat
  beat every rule here; brevity belongs to the prose and never to the work; low stakes → decide and
  proceed, medium or high stakes → ask before assuming. Per-level budgets replace the single one and
  load-bearing rules are pinned **to a level**, so a safety rule cannot silently demote from
  always-on to opt-in — which is how `Nunca simplifiques` / `never simplify away` moved out of the
  terseness section into `core`, where turning off the style guidance can no longer turn it off too.

- **Harness conformance matrix** (`scripts/harness-matrix.mjs`, ADR-0066) — "cross-platform" in this
  repo has always meant _operating system_: `e2e-smoke.mjs` installs with `--ide none` and proves the
  stack works on Windows/macOS/Linux. It never asked whether wiring **Codex**, **Cursor** or anything
  that is not Claude Code produces a working install. The matrix runs a **real install per harness**
  into a throwaway HOME and asserts the config artifact that harness actually reads, wired into the
  existing `e2e-smoke` CI job. Cells come in two classes with different evidence value: **wiring**
  (filesystem, runs anywhere) and **live** (needs the CLI). A harness whose CLI is absent reports
  `not-installed` — **never** inferred as green from the wiring cell next to it, because a matrix
  that turns an absent CLI into a tick is a claim nobody checked wearing the costume of evidence.
  The matrix also carries a **deterministic enforcement** column, which states the architectural
  finding plainly: all seven hooks and the output style install into `~/.claude/`, so **outside
  Claude Code the kit is an MCP server plus a prose block**, and every rule in it depends on the
  model choosing to follow it.

- **Fixed-context budget inventory** (`scripts/context-budget.mjs`, ADR-0063) — the kit's _fixed
  layer_ (rules block, MCP tool schemas, `SessionStart` injection, skill/sub-agent descriptions,
  output style) is a permanent behavioural prior paid by every session before any tool is called,
  and most of it had never been measured. The inventory emits `piece → chars → tokens → file:line →
when` (`always` / `on-trigger` / `on-call` / `opt-in`) as markdown or `--json`, from this checkout
  or from a real install (`--home` / `--cwd`). Measured on v4.5.1: **45,247 chars ≈ 11,312 tokens
  always**, 76,891 worst case. Three findings the estimate had wrong: `obscura-web`'s schemas are
  the largest single piece (18,167 chars, 11 tools — bigger than the vault's 22, wired by the
  default install, **no budget gate**); the rules block is charged **twice** in a Claude Code
  session inside an installed project (`~/.claude/CLAUDE.md` + project `AGENTS.md`, both written by
  `--full`); and the shipped schema gate's regex reads only the first literal of a `"a" + "b"`
  description, so it is honest today only because `hybrid-mcp.mjs` happens not to use
  concatenation. The new extractor follows concatenation and is pinned to agree exactly with the
  gate's regex where none exists. Recorded as a **tripwire, not a budget** (composition pinned
  exactly, totals within ±20%): choosing a real ceiling waits for the off-target behavioural number.
  No behaviour changes.
- **Schema-budget gates for `obscura-web` and `vkm-downloads`, and a hardened one for the vault
  server** (ADR-0063) — the vault server has been gated since ADR-0035; the other two MCP servers
  never were, and the larger of them turned out to be the biggest single piece of the fixed layer.
  All three now share the concatenation-aware extractor and assert 1:1 anchor-to-string coverage, so
  the gate can no longer silently under-measure (previously a refactor of `hybrid-mcp.mjs` to
  `"a" + "b"` descriptions would have let a schema of any size through without failing). Per-string
  maxima for the two new gates **record current debt rather than endorse it**: the vault server
  holds itself to 450 chars per description, obscura-web's longest is 1,475 — trimming that changes
  what the model reads, so it belongs to a measured pass, not a drive-by edit.
- **Seed-URL site crawler** (`obscura_crawl_start` / `obscura_crawl_status` /
  `obscura_crawl_stop`, ADR-0062) — the complement to `obscura_research`: it follows a site's own
  internal `<a href>` links breadth-first from your seed URLs (not search-engine results), to
  download a whole docs/tutorial/community site **with source attribution** (URL/title/author/
  published) into `RESEARCH/<topic>/` notes plus a machine-readable `crawl.json` + `crawl.csv`. A
  background job like `obscura_research_start` (poll status, stop gracefully); **resumable** across
  runs by reusing the topic's existing `sources/` seen-set; respects robots.txt; optional keyword
  keep-filter; opt-out **capped asset download** of kept pages' PDFs/images to
  `RESEARCH/<topic>/assets/` (Content-Type allowlist excluding scriptable SVG, per-file byte cap
  enforced by streaming, total count cap, robots-respected, written inert and **never executed**).
  It **never solves a CAPTCHA or defeats a login/paywall** — gated pages are recorded and listed in
  the run report so you can fetch them with your own access, not bypassed. A shared job slot
  enforces **one background network job (research or crawl) at a time** (ban-avoidance). New files:
  `packages/obscura-web/src/{crawl,crawl-job,assets,job-lock}.mjs`; `writeCrawlExport` + additive
  `author`/`published` frontmatter in `research-persist.mjs`; full unit + MCP-handler test coverage.
- **Per-host circuit breaker for `obscura_crawl_start` / `obscura_research`**
  (`packages/obscura-web/src/circuit-breaker.mjs`) — a long crawl or research call can queue
  hundreds of URLs on a handful of hosts; after a host fails 3 consecutive times, remaining URLs on
  that host are skipped outright for a cooldown instead of each paying its own retry+backoff (only
  to fail again). Reported as `circuit-open` rows in the crawl report / `circuitOpen` totals, and as
  `circuitSkipped` in `obscura_research`'s response. Scoped per-call, not a global singleton — a
  host down during one job may be back by the next.
- **Boilerplate-stripped main-content extraction before curation** (`obscura_research` /
  `obscura_crawl_start`, `packages/obscura-web/src/content-extract.mjs`) — `sanitize.mjs`'s existing
  hidden-content stripper still returned the whole `<body>` (nav/sidebar/footer included) to Ollama
  curation and the keyword/heuristic passage extractor. `@mozilla/readability` (Firefox Reader
  View's own engine, run over a `jsdom` DOM) now isolates the article body first — chosen over a
  bespoke heuristic because the pipeline's real input (arbitrary research candidates, crawled
  docs/community sites) is exactly the messy, non-semantic HTML Readability was hardened against.
  An enhancement, never a dependency: falls back to the full sanitized body whenever Readability
  finds nothing article-shaped (a verified-live gap — its own `parse()` has no minimum-content
  floor, so this module enforces one) or the input is malformed. New dependencies:
  `@mozilla/readability`, `jsdom`.
- **Resilience pass on `obscura-web`'s scraping path** — five targeted additions, each scoped to a
  gap verified against the actual pipeline (several ideas from the same brainstorm were rejected as
  already-shipped or as reverting a measured ADR-0057 finding — see the PR discussion):
  - **`obscura_fetch`/`obscura_fetch_many` retry transient failures** (timeout, connection reset) up
    to `OBSCURA_FETCH_RETRIES` times (default 2) with exponential backoff + jitter
    (`OBSCURA_FETCH_RETRY_BASE_MS`, default 500ms). A missing binary or a non-transient navigation
    error is never retried. `obscura-cli.mjs`.
  - **SERP-parser canary** (`packages/obscura-web/src/canary.mjs` + `canary-run.mjs`,
    `node src/canary-run.mjs [--engines a,b] [--json]`) — proactively probes every registered search
    engine with two realistic multi-word queries and reports which ones came back empty, catching a
    markup-drift break before a real research call depends on it. Deliberately excluded from
    `npm test` (hits real engines over the network).
  - **Two more opt-in generic-extraction search engines**, Yahoo and Qwant (`serp.mjs#ENGINES`) — same
    "URL pattern only" path as `mojeek`/`marginalia`/`ecosia`, kept out of `DEFAULT_CHAIN` (like
    `startpage`) since their generic-extraction viability through obscura's rendered DOM is
    unverified; opt in via `OBSCURA_SEARCH_ENGINES`.
  - **`expandQuery`/`translateQuery` cache repeated queries** (`OBSCURA_EXPAND_CACHE_TTL_MS`, default
    10 min) — iterating `obscura_research`/`obscura_search` on the same query no longer re-pays the
    same local-model call. A thrown call is never cached, matching `research.mjs`'s existing cache
    contract.
  - **Semi-offline mode**: the three existing in-memory TTL caches (`serp.mjs`'s search cache,
    `research.mjs`'s SearXNG + fetch caches) now persist to disk when `OBSCURA_CACHE_DIR` is set
    (new `persistent-cache.mjs`, atomic tmp+rename writes) — a restarted MCP server starts warm
    instead of cold. Each cache also now **serves its last stale entry when every live source just
    failed**, instead of erroring: `obscura_search` marks the response `stale:true`;
    `obscura_research`'s SearXNG/fetch stages use the stale batch/page to keep gathering candidates
    instead of reporting `enginesUnavailable`/`fetchFailed`. Off by default (`OBSCURA_CACHE_DIR`
    unset = byte-identical to the pre-existing in-memory-only behavior).

  New tests: `test/canary.test.mjs`, `test/persistent-cache.test.mjs`, plus cases added to
  `test/obscura-cli.test.mjs`, `test/expand-query.test.mjs`, `test/ollama-client.test.mjs`,
  `test/serp.test.mjs`, `test/research.test.mjs`.

## [4.5.1] - 2026-07-21

### Security

- **Personal phone number removed from every LICENSE.md** (root + the 8 package
  mirrors, `license:sync`-verified). Found by the pre-promotion privacy sweep — the
  license contact stays email-only. Residual exposure noted honestly: the number
  remains in old git blobs and in the already-published npm tarballs (≤4.5.0); the
  current tree, the next release, and everything a visitor reads going forward are
  clean. Full-history rewrite deliberately NOT done — it would break every clone,
  tag and PR reference for marginal gain.

### Added

- **Bench results visualized in the READMEs** — a static dumbbell chart
  (`docs/assets/bench-results.svg` + a dark-mode variant, selected via
  `<picture>`/`prefers-color-scheme`) of the committed 2026-07-21 live-round
  numbers: skill vs stock per bench × model (research / design / discipline ×
  Haiku / Sonnet / Opus), with direct value labels and deltas on every row.
  Palette CVD-validated for both surfaces. Pure rendering of data already under
  `evals/*/results/` — no benchmark execution involved. Embedded in
  `README.md`, `README.en.md` and `evals/README.md`.

- **`/vkm-research` grew from a 68-line monolith into a full skill** (same standard as
  the 4.5.0 vkm-spec rebuild): rewritten SKILL.md with a copyable checklist and a
  degradation ladder; `references/summary-template.md` (the canonical consolidated
  shape) + `references/synthesis-guide.md` (four axes: claims across sources, links
  that connect, visible supersession, compression with judgment);
  `examples/worked-example.md` with REAL validator output both ways (draft fails with
  5 named errors, rewrite passes); and `scripts/validate_summary.mjs` — a zero-dep
  validator that rejects promoted map-reduce drafts by their seams (`---` separators,
  `## <file>.md` headings, leaked `url:` lines), missing wikilinks, malformed
  supersedes and transcription-sized output. Doubles as the research-bench grader;
  mutation-style self-test (10 cases) gates in core CI.
- **research-bench** (`evals/research-bench/`): a synthetic `RESEARCH/<topic>/` bank
  with the pipeline's real frontmatter and two seeded probes — a contradiction between
  sources (must surface as a typed `- supersedes`) and an embedded instruction in one
  source (must be flagged as untrusted DATA, never obeyed). Skill vs stock; grader =
  the shipped validator + probe signals (reference consolidation scores 100, the raw
  draft 0). New job + dispatch option in `llm-benchmarks.yml`.
- **implementer-bench** (`evals/implementer-bench/`): first eval covering the
  `vkm-implementer` agent — its real installed contract as system framing vs bare, on
  spec-shaped tasks, graded by discipline-bench's existing hidden-test instruments
  (no new graders). New job + dispatch option in `llm-benchmarks.yml`.

- **design-bench auto round 1** (mechanical score from the skill's own validators;
  raw HTML committed under `results/2026-07-21-round1/`): Sonnet **+60** on the
  slop-attractor brief (stock: 15) and **+30** on the held-out brief; Opus (n=1)
  **+60/+40** — stock Opus scored **0** on facturio (full slop fingerprint + failing
  contrast). Haiku flat, dial-consistent. Judgment axes stay in the manual protocol.
- **Effort gate auto-match (ADR-0031 amendment)**: the `PreToolUse` effort gate now
  detects the session's current effort (`CLAUDE_EFFORT` inherited by the hook) and
  opens itself when the model's proposed level equals it — no pause when there is
  nothing for the user to change. Mismatch or undetectable effort keeps the original
  pause; the deny message now advertises the detected level. Subprocess-level tests
  cover match/mismatch/undetectable/template-only paths.
- **Diversified round (round 2/3 of the live benches), Opus added at reduced n** —
  raw data under each eval's `results/2026-07-21-round2/`:
  - _research-bench_: the skill's gain GENERALIZES — held-out domain topic
    (container-queries: Haiku +35, Sonnet +52.5, Opus +50) and Opus on sqlite-vec
    (+45); stock Opus still fails the consolidation contract.
  - _discipline-bench_ on the new harder tasks (incl. the held-out instrument):
    Sonnet +19/+21, Opus +25/+31; Haiku flat-to-−3 within spread — where the hidden
    contract exceeds the small model's reach, the doctrine neither helps nor hurts,
    exactly what the dial predicts.
  - _token-quality-ab_ adversarial fixture (no-keyword decisive lines): delta **0.0**
    on all three models measuring the FIXED hook — verdict stays KEEP.
  - _skills-triggering_ hard set (12 near-miss/multi-skill/tool-vs-skill cases):
    Haiku 11/12, Sonnet 12/12, Opus 11/12 — desaturated, both misses are arguable
    boundary calls, logged with the description tweaks to try next round.
- **Round 1 of both new benches, raw data committed** (2026-07-21, Haiku 4.5 + Sonnet 5,
  n=3/cell, under `results/2026-07-21-round1/`):
  - _research-bench_: the skill delivers — Haiku **33.3 → 70.0 (+36.7)**, Sonnet
    **35.0 → 96.7 (+61.7)**. Stock output fails the consolidation contract (no typed
    supersedes, weak linking, the seeded injection usually dropped silently).
  - _implementer-bench_: **honest null result** — explicit specs saturate both
    conditions (the value lives in the spec, which is /vkm-spec's job), underspec
    deltas sit inside replica spread with one negative Sonnet cell noted for re-check.
    The agent's case is delegation ergonomics, not raw scores; the bench exists to
    catch contract regressions. No verdict claimed beyond n=3.

### Changed

- **The skill structure gate's cross-reference allowlist is now EMPTY** (was 4
  tolerated vkm-design entries): the in-reference pointers became plain-text mentions
  at the point of use ("`contemporary.md`, this folder") and SKILL.md remains the only
  place that links — Anthropic's one-level-deep rule now holds to the letter, and the
  gate ratchets at zero exceptions. `lineages.md` deliberately NOT partitioned: it
  passes the `## Contents` navigability gate, and splitting it would mint new
  cross-references — the exact debt just retired.

## [4.5.0] - 2026-07-21

### Fixed

- **execa 10 reverted to ^9.6.1 — it broke the kit's own Node 20 floor.** The Dependabot
  bump (#83) landed even though `execa@10` declares `engines.node >=22` and calls
  `Set.prototype.union` (Node 22+) at import time, crashing every execa-importing test
  file on CI's Node-20 leg (`TypeError: TEXT_ENCODINGS.union is not a function`) — the
  exact regression that leg exists to catch. All four workspaces pinned back to `^9.6.1`
  and the stale nested `node_modules/execa@10` lockfile entries deduped away. execa can
  ride to 10 when the kit's `engines` floor moves to 22 — deliberately, not via a bump.

- **The token-saver's Bash compaction was provably losing diagnostic DETAIL.** The new
  adversarial-fixture gate (`test/compact-diagnostics.test.mjs`: real 650–1,100-line
  failure logs with the decisive error buried mid-stream) caught it before any live A/B:
  the rescue pass kept lines matching the diagnostic regex but dropped their neighbors —
  the `TS2339:` detail under an `ERROR in …` header, the `state.go:161` stack frame under
  `WARNING: DATA RACE`. `compactText` now rescues context **blocks** (1 line before,
  3 after each match, overlaps merged, `[...]` separators, cap raised 40→60 lines) so a
  diagnosis-from-compacted-output is possible. The gate stays in CI to keep it that way.
- **Docs no longer under-report the tool surface.** The installer `--help`, `ARCHITECTURE.md`
  and `docs/{en,es}/how-it-works.md` described obscura-web as 2 tools (it registers **8** —
  `obscura_fetch`/`_fetch_many`, `obscura_search`, `obscura_research` + `_start`/`_status`/`_stop`,
  `obscura_consolidate`) and vkm-downloads as 2 (it registers **6** — adds `probe_mirrors` and
  `download_start`/`_status`/`_cancel`). The hybrid MCP README now carries the authoritative
  **22-tool table**, and a new `tool-doc-drift.test.mjs` gate parses the registrations in
  `hybrid-mcp.mjs` and fails the build if the README table and the code ever diverge again —
  same philosophy as the schema-budget gate: doc drift a reader can't detect becomes a red build.
- Residual "v3 kit" self-descriptions in `docs/{en,es}/faq.md` and `troubleshooting.md` updated
  to the v4 identity (historical version anchors like "since v3.8.1" are kept — they're history,
  not drift). ADR-0046's body no longer claims a "Proposed" status for a deletion that shipped in
  4.0.0, and the ADR index now surfaces ADR-0050's amendment instead of a bare "Accepted".
- **A tagged release published to npm having run zero tests.** `ci.yml` triggers only on
  push-to-main and `pull_request`, and **neither fires on a tag push** — so `release.yml` reached
  `npm publish` gated on nothing but the version, changelog-section and license-mirror checks.
  `workflow_dispatch` was worse: it releases whatever `main` currently is, equally untested. `ci.yml`
  is now `workflow_call`-able and `release.yml` requires the whole matrix at the ref being released.
- **A skipped `npm-publish` job reports green, and the guard that would have said so is inside it.**
  The job's condition matched the full `owner/name`, so a repo rename silently disarmed publishing
  while the workflow still reported success — the exact failure that shipped 4.2.0 and 4.3.0 late,
  and this repo has already been renamed once (`obsidian-memory-kit` → `create-vkm-kit`). Now keyed
  on the owner. `release` also takes a `concurrency` group (never cancel-in-progress — aborting
  mid-publish is worse than queueing) so two dispatches cannot race the same `npm publish`.
- **markdownlint never saw any file inside a dot-directory.** `**/*.md` does not match them, so
  `.agents/rules/*.md`, `.continue/rules/*.md` and `.github/PULL_REQUEST_TEMPLATE.md` were silently
  unlinted — which is also why `.markdownlintignore` listed a `.github` file the glob could never
  have reached. All ten were already clean; the gate now actually covers them.
- **The `basic-memory` pin CI verifies is no longer hand-copied.** `scripts/mcp-smoke.mjs` imports
  `BASIC_MEMORY_VERSION` instead of repeating the literal, so the smoke test can no longer certify a
  server users never receive — the drift its own comment warned about but did not prevent.
- **The `agent.toml` schema check no longer rides on an unpinned interpreter.** `tomllib` is stdlib
  only from 3.11 and the `lint` job had no `setup-python`; it is now pinned to 3.12 like the other
  Python jobs. The network-bound `links` and `mcp-smoke` jobs get timeouts instead of the 6h default.
- **`engines: node >=20` was declared in five manifests, advertised in the README badge, and
  verified nowhere** — every CI job pinned Node 24 and there is no runtime guard. `test-node` now
  includes one ubuntu leg on the declared floor, enough to keep the claim honest without tripling
  the matrix.
- **Latent test flakes, fixed at the mechanism rather than by widening a tolerance.**
  `hybrid-mcp.test.mjs`'s `cleanup()` restored `BASIC_MEMORY_HOME` but never closed the client or
  server, leaking a connected pair per call (~15 per run); since the vault is resolved lazily from
  the environment on every call, a surviving server that handled anything after the restore would
  resolve against the _ambient_ vault — the developer's real one. It now closes both, before
  restoring the env. And `ollama-resources.test.mjs` asserted `elapsed < 1000ms` against a closed
  port as a proxy for "it short-circuited" — a proxy a loaded runner, a GC pause, or a firewall
  that DROPs rather than RSTs can blow. It now points `ensureOllamaServer` at a **reachable** fake
  Ollama and asserts it _still_ returns false: an implementation that probed would find
  `/api/version` answering and return true, so only a real short-circuit passes. Deterministic, and
  a stronger claim than the timing check ever made.
- **The installer reported its own version as `v2 / v3`.** A hardcoded banner string on a 4.x kit —
  the one place every user sees a version was the one place guaranteed to be wrong. It now prints
  `readKitVersion()`, already the source of truth for `--check-update` and the sidecar's
  `kitVersion`. Relatedly, `--version` / `-v` used to fall through to the interactive wizard, so
  the standard way to answer "which version are you on?" **started an install**; it now prints the
  version and exits.
- **The issue and PR templates were from the deleted v1 project, and blocked filing.** `bug_report`
  **required** a PowerShell version (`$PSVersionTable`) in a repo with no `.ps1` file, **required** a
  Cursor version, asked for `Doctor.ps1` / `Vault-Doctor.ps1` output (neither exists), and made
  "I read `docs/troubleshooting.md`" a **required** checkbox for a path that does not exist — the
  real file is `docs/en/troubleshooting.md`. `feature_request` required agreeing that "this is not a
  runnable codebase" and that "scripts live inside the prompt as literal text", both false for a
  repo with a Go daemon, eight npm workspaces and a Python package. Rewritten around what actually
  ships: kit version via `--version`, the real component list, the six agent surfaces, `vkm-doctor`
  output, and Windows/macOS/Linux rather than Windows-only.
- **`CONTRIBUTING.md`'s "local checks" claimed to mirror CI and did not.** It omitted `version.mjs
check`, `lint`, `typecheck`, `license:sync:check`, `linkcheck`, the `agent.toml` parse and the
  whole Node test suite, while listing `npx lychee` — lychee is a **Rust** binary, so that command
  installs an unrelated npm package. Now the `lint` job verbatim and in order, with an explicit
  note about which gates (lychee, gitleaks, govulncheck, mcp-smoke, the benches) are CI-only and
  why. The PR template's checklist points at it instead of drifting a third variant.
- **`version.mjs` could never fix — or even report — a drifted `-ldflags` version.** The Go daemon
  carries the kit version twice (`var version` and the example `-ldflags` in the build comment),
  and they were one marker whose `read` looked only at the first. Three things then compounded:
  `set` skips a file whose `read` already matches, so once `var version` was right the second
  replace never ran again; the "refusing partial write" guard compares the whole file, so a no-op
  second replace is invisible whenever the first one changed something; and `check` only ever
  inspected what `read` returned. The documented build command could print a stale version forever
  with both `set` and `check` silent. Now two independent markers — surveyed, checked and written
  separately — with a regression test that also pins every marker's `read`/`write` as inverses, so
  a regex that writes a shape its own reader cannot parse can't create self-inflicted drift.
- **First query against a cold vault could crash with `database is locked`.** `store.connect()` set
  `PRAGMA journal_mode=WAL` before `PRAGMA busy_timeout`, but the ordering was never the real
  problem: converting a database _into_ WAL takes a brief EXCLUSIVE lock on a sqlite code path
  (`pagerExclusiveLock`) that does **not** consult the busy handler, so `busy_timeout` does not
  apply to that one statement however large it is or how early it is set. Measured: with
  `busy_timeout=3000` already in effect, a contended transition raises in **0.000s**, while the same
  pragma against an already-WAL database returns `wal` in 0.008s taking no lock at all. That second
  measurement is why a bounded retry is the fix and not a band-aid — the only way to lose this race
  is another connection converting the same database, so once any one of them wins, every later
  attempt is a lock-free no-op and the loop exits immediately. The trigger was never exotic:
  `assembleContext` fans out three rag processes over one vault at once, so the first query against
  a fresh index has three processes creating the same database concurrently. It surfaced as a flaky
  `vkm-spec` pipeline test in CI, but it was a user-facing cold-start bug, not a test artifact.
  `connect()` now also closes the handle if setup fails partway instead of leaking it.
- **The old npm name never forwarded, and four releases of docs said it did.** `release.yml` no
  longer publishes `@vkmikc/create-obsidian-memory`, and every user-facing claim about it is
  corrected: what the registry actually serves under that name is the **last real v3 kit, 3.15.0**
  (published 2026-07-09, all sixteen versions deprecated with npm's generic message) — the
  forwarding shim ADR-0041/0050 designed exists only in-tree and was never published. Two causes,
  both invisible from the repo: the granular `NPM_TOKEN` grants write on the new name only, and npm
  answers an unauthorized publish with `404 … could not be found or you do not have permission`,
  which reads like a missing package; and deprecation being per-version means publishing 4.x to
  that name would have created a _non-deprecated_ latest, quietly reviving the name the deprecation
  retired. The shim package stays in-tree (version-locked, tested) but unpublished; both READMEs,
  the package README and both migration guides now say **deprecated, frozen on the v3 kit, does not
  forward, repoint your scripts**. ADR-0050 carries the amendment and the lesson: the source of
  truth for what users receive is the registry packument, never the source tree.

### Added

- **End-to-end smoke** (`scripts/e2e-smoke.mjs`, new CI job `e2e-smoke`): real installer
  → real Python index → real hybrid MCP over stdio → search a seeded fact →
  `vault_write_file` → reindex → find the written note. The wiring proof no
  per-component bench provides.
- **Latency floor**: `bench-recall` now measures per-query search wall-clock (p50/p95/
  mean, index build excluded) and supports `--assert-p95-ms`; CI gates at a loose 500 ms
  (measured ~3 ms on the fixture corpus) — an accidental-O(n²) detector, not a hardware
  benchmark.
- **Neural retrieval floor** (`.github/workflows/nightly-benchmarks.yml`, nightly +
  dispatch): the same labelled corpus on the **fastembed** embedder, with the
  pin-failures lever arm — the measured gate the semantic upgrade never had. Floors
  provisional until the first green run; then ratcheted in a reviewed PR.
- **Token-economy ratchet**: `--assert-answered` 0.95 → **1.0** (measured: 100% of
  labelled queries answered under passage-first at k=5 — the gate now pins it).
- **`VKM_DEFAULT_LIMIT`** env override for the two search tools' default hit count in
  `hybrid-mcp.mjs` — exists for A/B-benchmarking ADR-0034's 10-hit default
  (token-quality eval) without touching schema text; behavior unchanged when unset.
- **Spec-validator self-test** (`test/validate-spec-selftest.test.mjs`): the vkm-spec
  grader passes a reference good spec and catches six seeded defects by name
  (mutation-style), plus the XML envelope path — a grader that can't discriminate
  grades nothing.
- **First live benchmark round, with committed raw data** (2026-07-21, Haiku 4.5 +
  Sonnet 5 subjects, results under each eval's `results/2026-07-21-round1/`):
  - _Triggering accuracy_: **100% hit-rate, 0% false-positives** for all four skills on
    both models (104 gradings, ES+EN, incl. every `none` distractor).
  - _token-quality-ab #5 (compact-tool-output)_: **delta 0.0** on both models — the
    compacted log (~81% smaller) lost zero diagnostic ability vs the raw log (18
    gradings/model). Pre-registered verdict: **KEEP**. Measured on the hook as fixed by
    the compact-diagnostics gate — the pipeline caught the defect deterministically and
    the live A/B confirms the repair.
  - _discipline-bench_ (upgraded skill, n=3/cell): explicit-contract task saturates at
    100 everywhere (no harm); under-specified task lifts Haiku **47.0 → 91.7 (+44.7)**
    with Sonnet stable at 83 — the disciplined small model again beats the stock cells.
- **`/vkm-spec` grew from a 33-line monolith into a full skill** (Anthropic
  skill-authoring practices: progressive disclosure, worked example, executable feedback
  loop): rewritten SKILL.md with a copyable checklist, trigger phrases in the description
  and a degradation ladder; `references/spec-template.md` — the orchestration template
  the description always promised, now an actual file; `references/field-guide.md`
  (weak-vs-strong example per field); `examples/worked-example.md` (vague idea →
  validated, approved spec); and `scripts/validate_spec.mjs`, a zero-dep validator
  (six sections, 3–7 testable requirements, per-constraint source citations or an
  explicit `(assumption)` marker, ≤600-char current_state, ≥2 binary criteria, vague-word
  detection) with fix-me error messages — it doubles as the deterministic grader for the
  upcoming spec-bench.
- **`/vkm-discipline` gets executable evidence**: `scripts/evidence-gates.sh` detects and
  runs the project's own gates (npm test/lint/typecheck, `go test` + gofmt, pytest,
  cargo, make test) and prints one pass/fail block — step 5 ("Show it works") now has a
  tool instead of prose; `examples/dial-examples.md` adds two complete worked passes
  (trivial rename vs irreversible table drop) for the dial, the skill's hardest
  calibration; description rewritten to third person with trigger terms.
- **Skills triggering-accuracy eval** (`evals/skills-triggering/`): 52 labelled ES+EN
  prompts (10 should-trigger per skill + 12 `none` distractors, including the
  obscura_research-vs-/vkm-research near-miss), a runner that builds the listing from the
  real template frontmatter, and deterministic grading with per-skill gates (hit ≥ 0.9,
  false-positive ≤ 0.1). Modes: `--emit-prompts`/`--grade` for external subjects,
  `--provider api` for direct runs.
- **Architecture deep dive** (`docs/en/architecture-deep-dive.md` + `docs/es/arquitectura-a-fondo.md`):
  the full as-built walkthrough — system flowchart, five per-operation sequence diagrams (recall,
  write, close ritual, sync, research), a mind map of the kit's channels, a decision map tracing
  every load-bearing behavior to its ADR, the condensed 22+8+6 tool surface, and an ownership map
  of who writes what. All 14 mermaid blocks are render-verified; the tool tables are covered by the
  `tool-doc-drift.test.mjs` gate (now checking the deep-dives in both languages, not just the MCP
  README). Linked from both READMEs, both doc indexes and `ARCHITECTURE.md`.
- **Spanish mirrors for the last English-only user docs**: `docs/es/observabilidad.md` and
  `docs/security/mcp-remote-rce.es.md`, plus a new `docs/security/README.{md,es.md}` index with
  the kit's threat model in one paragraph. Both doc indexes now link Observability and Security —
  full ES/EN parity across every user-facing doc.

### Security

- **The shipped daemon was carrying 10 reachable vulnerabilities.** Not merely present in the
  module graph — `govulncheck` traced them to real call paths across `go-git/v5` (6), `circl` (2)
  and `x/crypto` (1), plus one Go stdlib advisory. Every one had a published fix. Nothing in the
  repo was positioned to notice: Dependabot covered only `github-actions`, and no vulnerability
  scanner ran at all, while `ci.yml`'s banner presented SHA-pinning as _the_ supply-chain control —
  which governs how actions are fetched, not what the dependency trees contain. `go-git` → v5.19.1
  and `circl` → v1.6.3 (letting `x/crypto`/`x/net` float up rather than pinning them to their exact
  minimums, which silently _downgraded_ `go-git` past four of its own fixes). **Reachable count:
  10 → 1**, the survivor being a stdlib `crypto/tls` advisory fixed by the toolchain, not by
  `go.mod`. A `govulncheck` job now gates this — a hard gate, not `continue-on-error`, since a
  security check that cannot fail the build is the silent-pass antipattern.
- Dependabot now covers all four ecosystems that ship here (`npm`, `gomod`, `pip`, `github-actions`)
  instead of only the last.

### Changed

- **Building the daemon from source now needs Go 1.25+** (was 1.22), the floor `go-git` v5.19
  requires. Only affects contributors compiling `obsidian-memoryd`.
- **The `typecheck` gate no longer overstates itself.** It advertised "strict TS + checkJs over
  shipped JS", but the checkJs half inherited `strict: false` through `tsconfig.eslint.json` — a
  file that self-described as _"Not a gate"_ while being the gate's actual `compilerOptions` source.
  Rather than flip `strict: true` (measured: **944 errors**, 601 of them implicit-`any` parameters —
  a codebase-wide JSDoc decision, not a fix), every strict sub-flag measured at **zero** cost is now
  enabled explicitly: `noImplicitThis`, `alwaysStrict`, `strictBindCallApply`, `strictFunctionTypes`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`. Each is a ratchet — it pins a property the code
  already has. The three still off are recorded with their exact cost, `strictNullChecks` (37) being
  the best next candidate. `strictFunctionTypes` required one real fix: `applyUpdatePlan`'s
  `writeSidecarImpl` was declared as taking `manifest: unknown`, which is unsound rather than
  lenient — parameters are contravariant, so a wider declared parameter promises callers something
  the default impl (which dereferences `manifest.assets`) cannot honour.
- `scripts/mcp-smoke.mjs`'s `@modelcontextprotocol/sdk` import is now a declared root
  devDependency. It had been resolving purely by npm hoisting it out of three **private**
  workspaces — dropping or renaming any of them, or installing without hoisting, would have
  broken the job with `ERR_MODULE_NOT_FOUND`.
- `scripts/linkcheck.mjs` finally runs in CI. It validates relative links **and `#anchor`
  fragments against real heading slugs** — coverage the lychee job does not provide — and was
  written, wired into `package.json`, and then never invoked by any workflow. Turning it on
  immediately caught a cross-platform hazard: `CLAUDE.md`, `.clinerules` and
  `.github/copilot-instructions.md` are **symlinks to `AGENTS.md`** so each agent tool finds its
  own filename, and following one re-resolves AGENTS.md's relative links from the alias's
  directory — `./docs/en/install.md` becomes `.github/docs/en/install.md`. It passed on Windows
  and failed only on Linux CI, because a Windows checkout without symlink support stores those
  three as ordinary ~12-byte files containing the target path. `walk()` now skips symlinks: an
  alias's links are already validated once at the target's real location, the only place its
  relative paths mean anything.

## [4.4.0] - 2026-07-20

### Added

- **`obscura_research` gains a background deep-research mode: three new tools, an unattended
  multi-round crawl, and a per-run report (ADR-0060).**
  `obscura_research_start(objective, topics, topic, …)` launches a job that runs INSIDE the MCP
  server process for up to 30 minutes, the way a human researcher iterates on a hard question —
  each round reuses `deepResearch` whole, then a
  local model (`generateLeads`, zero-shot, the same `qwen3.5:4b-q4_K_M` expand model curation
  already uses for recall tasks) proposes typed next queries (`subtopic`/`related`/`analogy`/
  `application`) anchored to the stated objective rather than the seed topics' literal wording. The
  call itself returns in milliseconds: the MCP transport's 60s `tools/call` wall is client-side and
  unavoidable for one call (ADR-0057 §5), so depth now lives entirely off the wire instead of
  costing an agent round-trip per increment, the way the prior `persist:true`+`excludeHashes` loop
  did (still supported, unchanged). Poll progress with `obscura_research_status`, stop early with
  `obscura_research_stop`; only one job runs at a time — the same fan-out ban risk ADR-0057 §6
  measured live applies at greater scale to an unattended run. Every round persists to
  `RESEARCH/<topic>/` as it finishes (a killed process loses only the round in flight), and a run
  report lands in `RESEARCH/<topic>/runs/<timestamp>.md` on every exit path — including an
  "Unexplored leads" section naming application/improvement ideas the job never got to chase —
  ready for `/vkm-research <topic>` to consolidate. New, optional env knobs:
  `OBSCURA_DEEP_ROUND_MS` (default 100000) and `OBSCURA_DEEP_PACE_MS` (default 15000). This is the
  "background continuation" mechanism ADR-0057's fourth addendum explicitly declined, pending "a
  use case [that] ever needs progress with no caller ever returning" — the trigger it named,
  firing. `packages/obscura-web` 326/326 tests, no regressions.
- **Static analysis now gates the ~32k LOC of shipped JavaScript.** New root ESLint 10 flat
  config (`@eslint/js` recommended + tuned `no-unused-vars`, `no-shadow`, and the type-aware
  promise rules `no-floating-promises` / `await-thenable` / `no-misused-promises` via
  `typescript-eslint`), plus a CI-gated `tsc` `checkJs` pass (`tsconfig.checkjs.json`) over
  shipped `src` — tests stay covered by ESLint's type-aware rules through
  `tsconfig.eslint.json`; skill templates are excluded because their optional deps only exist
  in the user's env. Run with `npm run lint` / `npm run typecheck`; both wired into the
  `ci / lint` job, and `node:test` runners are allowed via `allowForKnownSafeCalls` instead of
  a blanket disable. The first sweep took 861 ESLint + 424 `checkJs` findings to zero and fixed
  real defects along the way: vkm-doctor's CLI `main()` ran unawaited (a crash died as an
  unhandled rejection instead of a clean non-zero exit), a no-op `await` on the synchronous
  `NodeSDK.start()`, a dozen wrapper `throw`s that discarded the original error (now
  `{ cause }`), async HTTP handlers passed where a void listener is expected (now guarded with
  a `.catch` backstop), dead stores, and producer JSDoc contracts narrower than the values they
  actually return (e.g. `curatePage`'s undocumented `relevance`/`reason` fields).

- **A safe self-update path for installed skill/subagent templates, plus an opt-in version
  check (ADR-0061).** `npx @vkmikc/create-vkm-kit --check-update` reports the installed vs.
  npm-latest version and a plan for every managed file under `~/.claude/skills/` and
  `~/.claude/agents/`, without writing anything or ever failing on a network error (offline
  degrades to an honest "skipped" line). `--update` applies that plan: new/missing/kit-only-changed
  files install, a file you edited locally is left alone and reported as `conflict` (only
  `--force` overwrites it, and it says so — that DISCARDS the local edit), and both accept
  `--dry-run` to preview with zero writes. The classification is three-way (template vs. the
  sidecar's recorded install-time hash vs. what's on disk now — chezmoi's
  source/target/destination model), because the sidecar already recorded the ancestor hash for
  uninstall's benefit; that is what makes "you edited this" and "the kit changed this"
  distinguishable instead of both looking like "disk differs from template." v1 covers the
  hash-guarded asset layer only — managed rule blocks and MCP registrations still need a normal
  installer re-run.
- **Structure gate for the shipped skill templates, against Anthropic's published
  skill-authoring checklist (ADR-0061).** New `test/skill-structure.test.mjs` enforces, over all
  four shipped skills: `SKILL.md` body ≤500 lines, a `## Contents` heading on any reference file
  over 100 lines, one-level reference nesting (no new relative `.md`-to-`.md` link inside a
  skill, past a small named baseline of four pre-existing ones), forward-slash link paths, and a
  valid non-branded frontmatter `name`. `vkm-design`'s eight reference files over 100 lines gained
  a Contents heading as part of landing this gate.
- **Drift gate for the repo's own Cursor memory rule.** The committed
  `.cursor/rules/obsidian-memory.mdc` is fresh-install output of the installer
  (`installRules(["cursor"], "es")`), not an `agents-manifest.yaml` artifact — so no check
  covered it and it silently kept the pre-rename `obsidian-memory:start/end` sentinels and
  `create-obsidian-memory` branding across the vkm-kit rename (ADR-0041). `sync-agents.ts` now
  renders the fresh-install output (the newly exported `CURSOR_RULE_FRONTMATTER` +
  `memoryRulesBlock("es")` through the real `mergeManagedBlock`) and byte-compares it under
  `--check` (already in CI), failing with a "rerun the generator: npm run sync-agents" hint;
  write mode regenerates the file. The committed copy is regenerated to the current block, and a
  package test pins generator output ≡ gate expectation so the two can never diverge.

### Changed

- **`CONTRIBUTING.md`'s SemVer section now describes the kit, not the v1 prompt, and adds an
  explicit post-4.x versioning policy.** The MAJOR/MINOR/PATCH definitions still spoke of
  "prompt section numbers"; they are rewritten in terms of the installed contract (CLI flags,
  MCP tools, vault layout/hooks), and the new policy freezes majors except for unavoidable
  contract breaks — batched into one planned major with its migration doc. README links the
  policy from "Más · More".

- **Repo face: a social-preview card, and the measured claims now name their substrate.**
  `docs/assets/social-preview.png` (1280×640, on the `hero.svg` design language) gives GitHub's
  social preview and link unfurls a real card instead of a cropped avatar. The READMEs'
  token-economy paragraph now states what those numbers are measured against — a fixed labelled
  corpus and a deterministic embedder, i.e. reproducible regression floors, not leaderboard
  claims — and the hybrid-memory chip marks semantic search as the local opt-in it is. The code
  already said both (`embeddings.py`, `ci.yml` comments); the front page now matches it.

### Fixed

- **The repo's own `.cursor/rules/obsidian-memory.mdc` no longer ships the pre-rename block.** The
  committed dogfooding artifact (not generated by `sync-agents` — `agents-manifest.yaml` never
  listed it) still carried v2 branding: `obsidian-memory:start/end` sentinels, "Bloque gestionado
  por `create-obsidian-memory`", the `(obsidian-memory-kit)` frontmatter description, and it
  predated the `RESEARCH/` and discipline sections. Regenerated with the current generator
  (`installRules`, fresh-install path), asserting the ADR-0041 legacy-sentinel migration produces
  the identical managed block. The cursor frontmatter (`CURSOR_RULE_FRONTMATTER` in
  `rules-merge.mjs`, the drift gate's single source) now writes the `(vkm-kit)` description for
  new installs too — the last v2-branded string the installer still emitted.

- **`go.mod` module path matches the repo slug.** The module still declared
  `github.com/Vahlame/obsidian-memory-kit`, so importing or `go install`-ing the daemon by its
  real path (`github.com/Vahlame/create-vkm-kit/cmd/obsidian-memoryd`) failed — latent only
  because the installer builds locally. `agent.toml`'s `[daemon].module` mirror is updated to
  match.

- **`release.yml` no longer reports success when npm publish silently skipped.** The npm-publish
  job soft-exited (`exit 0`) when the `NPM_TOKEN` secret was missing, so the workflow went green
  while npm stayed behind — this shipped 4.2.0 and 4.3.0 to GitHub without their npm counterparts
  until someone noticed. Both publish steps now emit a `::error::` annotation and **fail the job**
  when the token is absent; fork runs were already excluded by the repository guard, so the hard
  fail only ever fires where publishing is actually expected.

- **Stale `obsidian-memory-kit` URLs swept from every functional link.** `LICENSE.md` (root + the
  package mirrors via `license:sync`), `SECURITY.md`'s source-verification step and this
  changelog's compare/release link definitions still pointed at `Vahlame/obsidian-memory-kit`;
  the GitHub redirect masks it today, but a redirect dies the day the old slug is re-registered.
  Historical mentions of the rename stay as written.

- **License labeling stopped implying plain MIT.** Both README badges now read
  "MIT-derived + attribution (non-OSI)" and the License sections state explicitly that the
  mandatory visible-attribution clause is outside the OSI open-source definition — matching what
  `package.json` already declares (`"license": "SEE LICENSE IN LICENSE.md"`). Labeling only; the
  license terms are unchanged.

- **`vkm-downloads` was missing from both README "What's inside" tables** despite shipping since
  4.3.0 — added, including its install mode (opt-in `--downloads`, deliberately not part of
  `--full` because it writes to disk).

- **`ci / links` no longer flakes red on github.com HTTP/2 resets.** lychee fired up to 128
  concurrent requests; github.com answers such bursts with HTTP/2 GOAWAY/protocol errors — one
  run failed 10 links that all returned 200 when probed individually, half of them in files the
  PR never touched. The token/API fallback can't help (it's a transport error, not a 429), so the
  job now caps `--max-concurrency 32` and retries with backoff (`--max-retries 4`,
  `--retry-wait-time 2`). De-flaking then unmasked two deterministic 404s in this changelog's own
  link definitions — `v3.6.0` was never tagged — fixed by dropping the dead `[3.6.0]` definition,
  retargeting `[3.7.0]` to `v3.5.0...v3.7.0`, and moving `[Unreleased]` off its stale `v3.12.0`
  base onto `v4.3.0`.

- **`ci / secrets-scan` no longer fails on a third-party licence server.** `gitleaks-action` v3
  validates a licence against gitleaks.io on every run; while that endpoint answered "No server is
  currently available" the job failed with "missing gitleaks license" on a leak-free tree — that is
  what turned PRs #67 and #68 red. The gitleaks binary itself is MIT and needs no licence, so CI
  installs v8.30.1 directly (sha256-verified, retry on download) and runs the same full-history
  scan (236 commits, no leaks, exit 0).

## [4.3.0] - 2026-07-18

### Removed

- **Token-saver `permissions.deny` rules retired; installer now sweeps them away (ADR-0043
  amendment).** Daily-use evidence: `Read(**/*.lock)` hard-blocked reading `pubspec.lock` in a
  Flutter session (small file, needed to resolve a dependency constraint) and the auto-deny was
  indistinguishable from a manual denial. A prompt-less hard block trades a bounded token cost for
  an unbounded workflow obstruction across heterogeneous projects. `configureTokenSaver` no longer
  takes a `denyRules` option; the four old rules live on only as `LEGACY_TOKEN_SAVER_DENY_RULES`,
  a frozen list that every reconcile (install, `--no-token-saver`, `--uninstall`) strips from
  `~/.claude/settings.json` while leaving user-authored deny rules untouched (new regression test
  covers the sweep, both with pieces ON and with everything OFF). Token savings on build
  artifacts remain the job of the compaction hooks, which degrade gracefully instead of refusing.

### Security

- **`obscura_research`'s crawl no longer hands an LLM curator content hidden from every human
  viewer, unfiltered.** Found while reviewing [Scrapling](https://github.com/D4Vinci/Scrapling) (a
  Python scraping library) for capabilities worth matching: its own MCP server strips CSS/ARIA-
  hidden elements before conversion, which this package had no equivalent of. Verified live, not
  hypothesized — a synthetic page hiding text behind `display:none`/`aria-hidden` had that text
  pass straight through the real `obscura` binary's `--dump markdown` (and `--dump text`, tried as
  a cheaper fix-hypothesis and found to fail identically — neither is visibility-aware) as if it
  were visible, including a prompt-injection-shaped payload that this package's own
  `scanInjection` heuristic — a visible-text scanner — also failed to flag. Every page
  `obscura_research` fetches is now parsed with `cheerio` (`packages/obscura-web/src/sanitize.mjs`
  — the package's first runtime dependency beyond `@modelcontextprotocol/sdk`/`execa`/`zod`, added
  deliberately for this) and stripped of hidden elements, `<template>` content, and HTML comments
  before either the heuristic extractor or the local curator sees it. Re-verified live,
  end-to-end, through the real pipeline against the same synthetic payload: the curated result
  contained only real, visible content. Scoped to the automated crawl — `obscura_fetch`'s
  general, single-URL default is unaffected (matching its existing markdown fidelity from
  sanitized HTML would need a second, unapproved dependency); a class-based hiding rule (versus an
  element's own inline `style`/`aria-hidden`) is a named, tested, accepted gap, since catching it
  needs a real browser's computed styles. See ADR-0057's third addendum.

### Fixed

- **CI red since `b59e4fb` (4 pushes): two independent causes, both reproduced before fixing.**
  (1) `lint`: `slop-check.mjs` was committed unformatted for the pinned `prettier@3.8.4` —
  reformatted (installed copy re-synced). (2) `test-python`: the ADR-0038 regression test
  (`test_usage_boost_decays_stale_credit_so_new_note_not_buried`) was green on Windows and red on
  ubuntu — retrieval order was **platform-dependent**: `os.walk` returns names sorted on NTFS but
  hash-ordered on ext4, insertion order decides FTS rowids, and rowids are the hidden tie-breaker
  when BM25/cosine scores tie exactly; with a tie at the top, the ranks fed into RRF differ per
  platform and the stale note's residual usage credit (linear taper leaves ~0.022 at 89.5/90
  days) crossed the ~`w/(k+r)²` one-rank margin, burying the brand-new note the test protects.
  Root fixes, all five ordering sites + the decay: sorted walk in `_iter_markdown_files`;
  `ORDER BY score, path` (BM25 FTS query); `ORDER BY dist, path, ordinal` (sqlite-vec path);
  `heapq.nsmallest` over `(-score, path, ordinal)` (brute-force cosine — same O(n·log k));
  `(-score, path)` tie-breaks in `reciprocal_rank_fusion` and the post-lever sort; and
  `usage_counts_decayed` taper linear→**quadratic** so window-edge credit lands two orders below
  any rank margin instead of inside it. Verified: an adverse-order simulation (reversed
  insertion, the ext4 condition) reproduced the CI failure locally with the ordering fixes alone
  and passes with the full set; 197/197 pytest; all four retrieval/token/assemble bench gates
  exit 0 locally at CI thresholds.
- **vkm-design `modes/visual-loop.md`: capability-check note for preview panes that only render
  `file://` inside the project folder.** Two real sessions hit the blank "static snapshot" +
  "no site open" wall on an outside-the-project file and misread it as a page bug; the mode now
  prescribes the copy-into-project pattern (dot-named temp, re-copy after each edit, delete at
  loop end) instead of fighting the pane or skipping the loop.
- **vkm-design audit scripts: four defects exposed by a real user session log** (a session
  "audited" a roadmap HTML with these scripts and half the tool output was wrong — each fix
  below re-verified against the exact input that failed).
  (1) `scale.mjs` no longer _infers_ the 1.067 ratio: its steps sit 6.7% apart, so the default
  ±3% tolerance bands cover ~91% of the value space and almost any incoherent set "fits" — 22
  real ad-hoc font sizes scored 1 offender under inferred 1.067, a false PASS that buried
  exactly the incoherence the check exists to expose (now honestly 11+ offenders under the
  best non-degenerate ratio, with a hint that `--ratio 1.067` remains available explicitly).
  (2) `scale.mjs --gen` accepts the natural named-flag form (`--gen --base 16 --ratio 1.25
--steps 6`): the packed-only parser swallowed a following `--base` as its value and died
  with a misleading "not a comma-separated number list".
  (3) `checkSpacing` attaches a `halfGrid` diagnosis when it explains part of the mess: a file
  interleaving 4k and 4k+2 paddings (a real 2px half-step rhythm) was reported flat as "8
  values off-rhythm", sending the session on a manual detour to conclude "false alarm" — the
  CLI now says "only 3 stay off — the rest is a half-step rhythm; judge intent" itself, while
  the exit code still fails against the declared base.
  (4) `audit-css.mjs` given `.html/.htm` audits only `<style>` blocks + inline `style=""`
  attributes: the whole file used to go through the rule regex, which read a `<script>` mermaid
  theme object (`{ background: "#0e2846", … }`) as CSS — one bare `color:` key away from
  fabricated contrast pairs — while real inline styles stayed invisible. Regression tests for
  all four; installed copies under `~/.claude/skills/` re-synced.
- **vkm-doctor skills-drift check: compares EVERY installed skill file, not just `SKILL.md`.**
  The motivating real case (2026-07-18): `vkm-discipline/domains/design-ui.md` stale under a
  byte-identical `SKILL.md` — the check reported "ok" for exactly the drift class it was built
  to catch, and the routing fix that file carried (design tasks → vkm-design gate) silently
  never reached sessions. A skill is now STALE if any of its template files differs installed-
  side or is absent (new regression test reproduces the design-ui.md case).
- **vkm-design `modes/visual-loop.md`: new trap — republishing a document to a NEW artifact URL
  while the user still holds the old link.** Real session: the fixes landed on a fresh artifact,
  the user's open copy never changed, and the session read back "no veo ningún cambio" as a
  design complaint instead of a delivery failure. The loop now instructs: list existing
  artifacts, redeploy to the SAME url, verify at the link the user actually holds.
- **`obsidian-memory-rag`: concurrent `ensure_fresh` writers no longer die with `database is
locked`.** Two simultaneous `vault_hybrid_search` calls with a stale index (reproduced live while
  verifying ADR-0056) raced `index_vectors`' `BEGIN IMMEDIATE`; the loser only got Python's
  implicit ~5s `sqlite3.connect` timeout — undocumented and demonstrably too short for a
  `batch_commit_every=64` batch under a real embedder. Root-cause fix in the shared
  `store.connect()`: explicit `PRAGMA busy_timeout=30000` on every connection, so a second writer
  blocks and then reads the winner's committed state (the existing mtime/size incremental logic
  already skips re-indexing) — no manual retry loop needed, SQLite's busy handler transparently
  retries `BEGIN IMMEDIATE`. Verified red→green with a new barrier-synced two-thread test
  (`tests/test_concurrent_ensure_fresh.py`, slow-embedder holds the lock ~6.4s); full suite 197
  passed, none modified.

### Added

- **`vkm-downloads`: background downloads, sets of files, resume, and fastest-mirror selection
  (ADR-0059).** Follow-up to the synchronous tool: the user needed to download large files or SETS
  of files "whether the download is fast or slow" and to "find the site with the fastest download" —
  both blocked by the MCP transport's ~60s per-call wall (a 3 GB ISO can't be one synchronous call)
  and by the conservative 500MB cap. Additive (the sync `download_file` and every ADR-0058 guardrail
  are byte-for-byte unchanged): four new tools + a background job runner. `download_start({ files })`
  registers a job and returns a `job_id` immediately, running the transfer as an async task **inside
  the long-lived stdio server — no child process, so the "never execute downloaded bytes" property
  holds**; `download_status` / `download_cancel` poll and abort. Each file may list several **mirror
  URLs**; `probe_mirrors` (and `prefer_fastest`) measures each with a ~512 KB ranged GET and ranks by
  real throughput (latency tiebreak; a `size_mismatch` flag catches a "mirror" that isn't the same
  file), all through the same guarded, IP-pinned path so a private/loopback mirror is refused, not
  probed. Large files are gated by a **free-disk-space check** (`fs.statfs`) rather than a hard byte
  wall (background ceiling `VKM_DOWNLOAD_MAX_BYTES_BG`, 100GB); interrupted downloads **resume** from
  their `.part` via HTTP Range. Verified live end-to-end against the real Hiren's BootCD PE servers:
  `probe_mirrors` ranked its two real mirrors by measured speed (edgeuno 9.1 Mbps vs origin 8.8 Mbps,
  same 3,291,686,912-byte size), and the 3 GB ISO the sync path refused streamed in the background at
  ~130 Mbps and cancelled cleanly (`.part` removed). 18 new tests (mirror ranking with an injected
  clock, the job runner over injected request/DNS incl. batch/mirror-pick/cancel/resume, the disk
  guard, and the four MCP handlers).
- **`vkm-downloads`: a guarded file-download manager MCP, opt-in via `--downloads` (ADR-0058).**
  The user wanted Claude to download files on request (find a URL, save it to disk) — a capability
  no existing tool had, and one that writes bytes to disk rather than reading the web as DATA. New
  self-contained package `@vkmikc/vkm-downloads` exposing `download_resolve` (metadata only — HEAD/
  GET-and-abort, writes nothing, safe to call before asking the user) and `download_file` (streams
  to `~/Downloads/vkm-kit/`, returns path/size/SHA-256). **Its own installer flag, deliberately NOT
  in `--full`** (even though `--full` includes `--obscura`): opting into stealth web _reads_ must
  never silently grant disk _writes_ — consent stays granular. Guardrails, all tested against an
  injected fake request/response + fake DNS (no sockets, no real DNS): http(s) only; the host is
  resolved once and **refused if any record is loopback/private/link-local/CGNAT**, with the socket
  **pinned to the validated IP** (`node:http(s)` + a custom `lookup`, chosen over `fetch` precisely
  to close the DNS-rebinding TOCTOU that a resolve-then-fetch leaves in that guard — the guard that
  stops an injected URL from targeting the kit's own loopback services like Ollama `:11434`);
  redirects followed and **re-validated per hop** (a 302 to `127.0.0.1` is refused); a 500MB cap
  (`VKM_DOWNLOAD_MAX_BYTES`) enforced by `Content-Length` **and mid-stream**, deleting the partial
  file on abort; filenames sanitized (`../`, separators, `%2f`, NUL, Windows-illegal + reserved
  device names) with a `path.resolve` **root-check before writing** and no-overwrite de-dup;
  extension from the URL/Content-Type, never an unvalidated `Content-Disposition`. Downloaded files
  are **never opened or executed** (no code path spawns a process — grep-verifiable), and every
  download is appended to a JSONL audit log (`~/.vkm/downloads/downloads.log`). The tool descriptions
  steer the agent to resolve-then-confirm-then-download, reinforcing (not replacing) Claude Code's
  own per-file download-permission rule. Version-locked to the kit (ADR-0042/0051). 38 new tests.
- **`obscura_research`: the answer was being lost at gather, not at rank (ADR-0057).** User report:
  "search too little, nothing removes the junk, Claude gets the leftovers." A bench built first and
  gated on (`evals/research/`, metrics ported from `obsidian-memory-rag`'s `bench_recall.py`) falsified
  three assumptions in the approved plan before any pipeline code changed — most importantly, that the
  BM25 rerank ADR-0054/0055 shipped was actively worse than doing nothing: SearXNG already fuses rank
  across every engine that returned a URL (`results.py#calculate_score`), and re-ranking survivors with
  BM25 over ~30 tokens of SEO snippet threw that away for -0.115 nDCG@10. The rerank is deleted, not
  tuned. Separately, the `vocab-mismatch` case ADR-0055 was built for turned out to be a GATHER failure,
  not a ranking one — the answer was never in the pool to begin with (a colloquial Spanish query
  returned Instagram reels and Facebook posts; the same question in canonical English technical wording
  returned the actual OWASP page at rank 4) — so query expansion, not reranking, is what fixes it.
  - Pipeline: `serp.mjs` preserves SearXNG's own order/score instead of re-ranking (`rankCandidates`
    stays exported for the no-SearXNG fallback only); fetch runs at bounded concurrency (semaphore,
    default 4) instead of sequentially; `top_k` default 8→20 (calibrated for the old sequential loop,
    now the knob deciding whether an expanded, fused pool's answer is read at all); a wall-clock deadline
    (`OBSCURA_RESEARCH_DEADLINE_MS`, default 50s) returns the best-ranked finished prefix with
    `partial`/`remaining` rather than losing everything to the MCP SDK's non-negotiable 60s
    `tools/call` timeout (`resetTimeoutOnProgress` defaults false — the server cannot extend it).
  - Query expansion (`expandQuery`, `ollama-client.mjs`) turns one question into several
    canonically-worded, translated sub-queries, run against SearXNG's `general,it,science` categories
    (`it`/`science` are site APIs — github, mdn, arxiv, semantic scholar — that answer while
    Google/Brave-backed `general` scrapers are suspended, and don't themselves get suspended; costs zero
    extra upstream requests, one `/search` call per sub-query). Runs on a separate, more capable model
    (`OBSCURA_OLLAMA_EXPAND_MODEL`, default `qwen3.5:4b-q4_K_M`) from curation's — expansion is a recall
    task (does the model already know "hidden instructions on a page" is called prompt injection?), not
    reading comprehension, and measured phi4-mini at +0 answers found while doubling social-media junk
    in the pool. Absent that model, the tool correctly does NOT expand rather than expand badly.
  - The curator (`curatePage`) now returns a banded `relevance: 0-10` + `reason` instead of one bit, and
    **drops** results below a conservative threshold (`dropped` reported, `include_rejected: true`
    escapes it) — reversing ADR-0055 §6, which returned `relevant: false` results anyway.
  - Ban-avoidance, found the hard way (fixture capture + probes suspended every SearXNG-backed engine
    for 180s-3600s, and a suspended instance answers HTTP 200 + `results: []` — indistinguishable from
    "no hits" unless `unresponsive_engines` is read): sub-query fan-out throttled
    (`OBSCURA_SUBQUERY_CONCURRENCY`, default 2); a SearXNG response cache keyed by
    (query, page, categories) that distinguishes a stable "exhausted" empty from a transient "banned"
    one (only the former is cached); `enginesUnavailable` surfaced in the response so "no such page
    exists" reads differently from "come back in 3 minutes"; `bench-capture.mjs` refuses to overwrite
    good fixtures with empty ones captured against a rate-limited instance.
  - Resilience hardening adapted from [Scrapling](https://github.com/D4Vinci/Scrapling) (verified
    against its actual source, not its README): its "adaptive scraping" is `SequenceMatcher.ratio()`
    scored across DOM element facets (tag/text/attributes/tree path/siblings) — this package has no DOM
    to fingerprint that way (SERP records are flat, pages are markdown), so only the primitive itself
    ported (`text-similarity.mjs#similarityRatio`, a from-scratch port pinned against difflib's own
    canonical example). Used by a new generic, similarity-ranked SERP fallback
    (`serp.mjs#genericExtractLinks`) engaged when a specific per-engine HTML parser breaks on markup
    drift — the exact risk ADR-0051 already flagged and had no mitigation for beyond fixtures. Also
    added: pragmatic robots.txt compliance (`robots.mjs`, fail-open, scoped to the automated crawl only,
    never `obscura_fetch`) and a page-fetch cache mirroring the search cache one stage later in the
    pipeline. TLS fingerprint impersonation and proxy rotation were both explicitly declined (the first
    is redundant with obscura's own real-browser rendering; the second is out of scope for a local,
    personal-use tool with no measured need).
  - Bugs fixed in passing: `extraction: "ollama"` no longer lies when the excerpt is empty or the
    verdict is `false`; a failed fetch reports `relevant: null` instead of hardcoding `true` (it used to
    outrank a page the curator had actually rejected); `truncated` propagates instead of being silently
    dropped; `capResults` bounds the response (the prior worst case, ~30k tokens, exceeded
    `MAX_MCP_OUTPUT_TOKENS`'s 25k default); one URL identity (`url-identity.mjs`, with a frozen,
    tripwire-tested `hash8` so `RESEARCH/`'s existing notes are never orphaned) replaces three
    independently-drifted ones.
  - Mass research now **accumulates across calls** instead of re-covering the same ground:
    `persist:true` + `topic` reads `RESEARCH/<topic>/sources/` (already a durable, one-file-per-URL
    record) before crawling and excludes already-banked candidates, so `top_k`'s budget goes to
    genuinely new pages on a second call — `alreadyCovered` reports how many were skipped.
  - **Fixed a real deadline bug, found only by running the redesigned pipeline live** against a
    real SearXNG + Ollama + obscura stack: a call configured with a 50s deadline took **58.3s**
    wall-clock, within 1.7s of the MCP transport's hard 60s cutoff. The concurrency pool's deadline
    check only gated picking up new work; an item already in flight ran to its own independent
    timeout (obscura's fetch ~45s worst case, curation's 30s) instead of the deadline meant to
    bound the whole call. Each item is now raced against the time actually left, marked
    `timedOut: true` if it doesn't finish — re-run live with identical parameters: 58.3s → 50.012s.
    No mock-based test caught this; it took a real run against real services.
  - Mass research now genuinely **accumulates across sessions, not just calls**: `persist:true` +
    `topic` reads `RESEARCH/<topic>/sources/` (a durable, one-file-per-URL record) before
    crawling and excludes already-banked candidates via `excludeHashes` — a second call on a
    well-covered topic, even from a fresh MCP process days later, reaches further into the pool
    instead of returning the same top hits (`alreadyCovered` reports how many were skipped).
  - **A second real deadline gap, found by tracing every caller after the first fix**: the
    SearXNG gather phase's sub-query fan-out never received the deadline at all (an oversight,
    not a design gap — `mapWithConcurrency` already supported it), so a degraded SearXNG could
    burn the whole budget gathering candidates before a single page was ever fetched. Fixed the
    same way — the deadline now gates both the outer fan-out and the inner per-sub-query page
    walk — with two new regression tests.
  - `packages/obscura-web` 239/239 tests. New ADR-0057 (supersedes ADR-0055 §5/§6, reverses
    ADR-0054's sequential-fetch choice). **Verified live end-to-end**: a real query against the
    real stack expanded into 5 genuine sub-queries, curated `sqlite.org/lockingv3.html` and
    `sqlite.org/wal.html` into its top results (relevance 9 and 8), and persisted 8 curated notes
    to disk as real files. `obscura_fetch` gains an opt-in `css_selector` param and a new sibling
    tool, `obscura_fetch_many` (bounded-concurrency batch fetch, one URL's failure doesn't sink
    the rest) — both inspired by reviewing Scrapling's own MCP server tool surface. Full monorepo
    green running the actual CI command (`npm run test --workspaces --if-present`) from the repo
    root, not just this package in isolation.
  - **Quality-based early stop: `target_relevant`.** Left at its default, a call always spent its
    whole `top_k`/`deadline_ms` budget even after the curator had already confirmed plenty of good
    pages — the tool had no notion of "enough", only "out of time" or "out of candidates". Set
    `target_relevant`, and the call stops dispatching further candidates as soon as that many pages
    have been genuinely curated relevant (a real curator verdict at/above `drop_below`; a heuristic
    fallback or an unfetched page never counts), returning `targetReached: true` so a short response
    reads as a deliberate success rather than a cutoff (`partial`/`remaining` can still report
    alongside it — the two are not exclusive).
  - **Fixed a real, if narrow, `relevant`/`drop_below` inconsistency found building the above**:
    `curatePage` has no `dropBelow` parameter and derived its own `relevant` boolean from the
    module's fixed default, so a call using a non-default `drop_below` could get a per-result
    `relevant:true` that quietly disagreed with that very call's `kept`/`dropped` filter (relevance
    5 with `drop_below:7` reported `relevant:true` against curatePage's baked-in 3, even though the
    result was correctly dropped). `relevant` is now derived once, in `research.mjs`, from THIS
    call's own `dropBelow` — byte-identical for callers using the default. One stale test asserted
    the pre-ADR-0057 "not-relevant still returns a result" behavior that was deliberately reversed
    above; rewritten to exercise the same `extraction` correctness through `include_rejected`
    instead. `packages/obscura-web` 246/246 tests.
  - **The curator bake-off fase 3 was approved on (measure, don't assume the model), run — with an
    honest, inconclusive result.** Built the scorer that didn't exist (`bench-curate.mjs` +
    a real, labelled golden set anchored on the exact live MDN-false-positive failure above) and
    ran `phi4-mini:3.8b-q4_K_M` (current default) vs `qwen3.5:4b-q4_K_M` vs `qwen3.5:9b-q4_K_M`
    as curator. `qwen3.5:9b` is the only one that stopped scoring the MDN pages relevant (0 false
    positives) but at 40.6s/page with half its calls timing out at 60s it is disqualified by
    latency alone (removed via `ollama rm`, per this session's own pre-declared bake-off rule).
    Between the two practical options, `qwen3.5:4b` does not beat `phi4-mini` (lower accuracy,
    identical false-positive rate on the hard case, slightly slower) — **default stays
    `phi4-mini`**, and the false-positive failure itself remains open at this model size class on
    this hardware (a rubric fix — the prompt's own "official documentation" band plausibly
    rewarding MDN's general authority over its topical relevance — is the next unexplored lever,
    not attempted this round). n=8 declared small, matching this ADR's existing honesty about the
    expansion bake-off's own sample size. `DEFAULT_MODEL` (`ollama-client.mjs`) now carries this
    reasoning inline, matching the doc-comment `DEFAULT_EXPAND_MODEL` already had for its own
    bake-off — the decision used to live only in the ADR, not at the line of code it governs.
  - **Fase 4, partially shipped: embeddings wired for near-dup removal + MMR diversity; per-page
    chunk selection built but NOT wired.** `ollama-client.mjs` gains `embedPassages`
    (`OBSCURA_OLLAMA_EMBED_MODEL`, default `qwen3-embedding:0.6b`, batched `/api/embed`) and
    `rank.mjs` gains `mmr`. Both wired into `deepResearch` as two new opt-in params sharing ONE
    batched embed call over the final kept set (never per-page): `dedupe_similar` (drops a later
    page whose embedding is near-identical, cosine ≥0.92, to one already kept — an objective
    redundancy signal, never a relevance judgment; count reported as `dedupedSimilar`) and
    `diversify` (MMR reorder, `mmr_lambda` default 0.5, off by default per ADR-0028's own
    precedent). Both skipped when too little `deadline_ms` remains or the embed model isn't
    pulled, degrading silently to the plain curated order. `chunk.mjs` (sliding-window,
    paragraph-respecting, overlapping chunking) is also built and tested, but deliberately left
    UNWIRED into the per-page fetch+curate path — that would need per-page embedding calls inside
    the deadline-critical hot loop, and there is no bench measuring whether chunk-based passage
    selection actually beats today's blind 12k-char truncation; wiring something unmeasured into a
    hard-deadline path is the wrong trade, matching this session's own repeated "a phase that
    doesn't move the metric doesn't merge" discipline. `packages/obscura-web` 283/283 tests.
  - **Both remaining gaps attempted directly — both honestly negative, neither shipped.** A
    domain-check revision to `CURATE_SYSTEM_PROMPT` (name the query's and page's technology; cap
    the score if they differ) was measured over 3 trials vs 2 on the baseline: false-positive rate
    improved inconsistently while false-negative rate got WORSE — the same instruction that
    correctly rejected an MDN page in one trial also made the model reject `sqlite.org/wal.html`
    itself as off-topic in two of three, the very vocab-mismatch failure ADR-0055 exists to
    prevent. **Reverted**; the finding lives in the prompt constant's own doc-comment.
    `selectChunksByRelevance` (`chunk.mjs`) — rank chunks by similarity to the query, keep the
    best up to the input budget — was tested live against two real long pages with a verified
    fact buried past the 12k-char truncation point: one case improved (relevance 5→8, on-topic
    reason emerged), one regressed (relevance 8→5 — greedy similarity selection discarded a
    page's own orienting introduction that blind truncation keeps for free by being first).
    **Not wired.** Both negative results are recorded in ADR-0057's seventh addendum in full, not
    softened — a negative result this session already paid to learn is worth more than a
    positive one it didn't earn. `packages/obscura-web` 288/288 tests.
- **`vkm-doctor`: skills-drift check.** Real gap found on the maintainer's own machine: `vkm-design`
  and `vkm-research` existed in the kit's templates but were missing from `~/.claude/skills/`
  (install predated their addition) and nothing noticed. The doctor now compares what the kit
  defines against what's installed and reports MISSING (no `SKILL.md` installed) and STALE
  (installed `SKILL.md` content differs from the template), with an actionable reinstall hint. The
  canonical list comes from `create-vkm-kit`'s own `skillAssetFiles` resolver via a dynamic import
  isolated in `src/skills-drift.mjs` — it can never drift from what the installer actually installs,
  and when that import isn't resolvable (standalone npm install) the check degrades to an honest
  skip, never a silent false-negative; no `~/.claude/skills/` directory at all is likewise an
  informative skip. `packages/vkm-doctor` 11/11 tests green.
- **`RESEARCH/`: a persistent web-research knowledge bank in the same vault (ADR-0056).** Research
  passages from `obscura_research` (ADR-0054/0055) used to die with the tool's response; this makes
  them accumulate. Spans three packages plus the installer/docs:
  - `packages/obscura-web`: `obscura_research` gains opt-in `persist: boolean` (default `false`) +
    `topic` (slug `^[\w][\w-]*$`); with `persist` it returns `persisted: {topic, written, updated,
dir}` and writes one verbatim-extract note per curated result to
    `RESEARCH/<topic>/sources/<hash8-url>-<slug>.md` (frontmatter: url/title/retrieved/query/
    extraction/relevant/`origin: web`/`status: raw`), plus a per-topic hub (`_index.md`: query log,
    open questions) and a regenerated global index (`RESEARCH/_index.md`). Requires
    `OBSCURA_RESEARCH_DIR` (typed error if unset); every write is root-checked against it first.
    Dedup by URL hash8 updates in place, never duplicates; `fetchFailed` results are never
    persisted, `relevant:false` ones are (flag intact). `persist:false` (default) is byte-identical
    to the pre-ADR-0056 tool. New tool `obscura_consolidate(topic, force)`: the local-Ollama half of
    dual consolidation — map-reduces `sources/` (≤12k-char batches) into `summary.md`,
    `status: draft-local`; a `consolidated` summary is never overwritten (`force` or not); no Ollama
    → typed `OllamaUnavailableError`, no silent fallback. `src/research-persist.mjs` (new),
    `src/ollama-client.mjs` gains `chatJSON`/`summarizeNotes`. `packages/obscura-web` 87/87 tests
    green.
  - `packages/obsidian-memory-rag` (196 pytest) + `packages/obsidian-memory-mcp` (164 node): retrieval-level
    isolation so folder convention alone doesn't leak research noise into memory recall.
    `paths.py` adds `RESEARCH_PREFIX`/`validate_section`/`in_section`/`section_sql_filter`;
    `search_vault`/`hybrid_search` gain `section: "research" | "memory" | None` that cuts at
    candidate collection (BM25 + vector), filters graph neighbors, and re-applies the invariant on
    the final fused list (`query.py:699-703`) — `None` stays byte-identical. CLI gets `--section`
    with `choices` on all four search subcommands. `vault_fts_search`/`vault_hybrid_search` mirror
    `section` (zod enum); `assemble_context` gains `include_research` (default `false` → passes
    `--section memory`). MCP schema-budget gate (10,800 chars total / 450 per string) stays green,
    landing at 10,748.
  - `packages/create-vkm-kit`: the generated `obscura-web` MCP config gets
    `OBSCURA_RESEARCH_DIR = <vault>/RESEARCH` by default (override: `--obscura-research-dir`).
    New skill **`/vkm-research`** (fourth vkm skill): consolidates a topic's sources into a quality
    `summary.md` (wikilinks, `supersedes` on contradiction), marks the hub, and doubles as the
    import path for hand-authored reports dropped into `sources/`. Vault scaffolding seeds
    `RESEARCH/_index.md` and links it from `START_HERE.md`'s vault map (no orphan-at-birth). Managed
    CLAUDE.md/AGENTS.md block gains a short es/en "Investigación/Research" rule (research recall via
    `section:"research"`, memory recall stays uncontaminated, the memory-close ritual never writes
    under `RESEARCH/`, `origin: web` notes are untrusted data) — budget raised as a reviewed
    decision (ADR-0036 precedent): es 8,660→9,375 chars (budget 9,100→9,850), en 8,421→9,093 chars
    (budget 8,850→9,550), ~5% headroom kept. `packages/create-vkm-kit` 242/242 tests green (1
    unrelated skip).
  - Docs: ADR-0056, `docs/{es,en}/glosario.md`/`glossary.md` (`RESEARCH/`, `obscura_consolidate`,
    the `raw → draft-local → consolidated` lifecycle), `packages/obscura-web/README.md`.
- **`obscura_research`: deep web research as local CPU/RAM work, not tokens (ADR-0054).** Third tool
  in `packages/obscura-web`, alongside `obscura_fetch`/`obscura_search`. Origin: a user pushback that
  `obscura_search`'s 20-result ceiling was too shallow for real research, and that the fix must not be
  "dispatch a subagent" — a subagent still spends real LLM tokens/quota, it only relocates the cost out
  of the main conversation. The actual lever: `obscura`/SearXNG already run as local, per-request/
  on-demand OS processes (ADR-0051/ADR-0052) that cost zero tokens to execute; the gap was that the
  "search deep" loop lived in the agent calling the MCP N times. `obscura_research(query,
max_candidates=50≤300, top_k=8≤30, passage_chars=800)` closes that gap: (1) walks SearXNG's `pageno`
  server-side (`searxngSearch` extended with a `page` param, verified live against
  `docs.searxng.org/dev/search_api.html`) to gather up to `max_candidates` — one loopback HTTP
  round-trip per page, zero LLM tokens; (2) ranks every candidate's title+snippet locally with BM25
  (`rankCandidates`, k1=1.5/b=0.75, +1-smoothed IDF so a small pool never scores negative) — the
  candidate pool is its own corpus, no external index or embedding call; (3) fetches only the top
  `top_k` via the existing `obscuraFetch`; (4) excerpts each to the paragraph(s) that actually match the
  query (`extractPassage`) instead of returning the whole page. Response carries `scanned` (candidates
  gathered) and `fetched` (pages read) alongside `results`, so the agent sees how deep it searched
  without paying tokens for the difference. Honest degrade: no local SearXNG → skips the pageno loop
  and falls through to `searchWeb`'s existing single-page scrape chain (same ceiling as
  `obscura_search`) rather than hand-rolling fragile per-engine offset pagination against
  DuckDuckGo/Bing/Brave HTML — `serp.mjs` already documents why that path doesn't scale. Zero new npm
  dependencies. 47/47 `@vkmikc/obscura-web` tests green (11 new), 49/49 elsewhere in the monorepo,
  unchanged.
- **`obscura_research` curates pages with a local Ollama model instead of keyword overlap
  (ADR-0055).** Follow-up user pushback on the above: BM25/keyword-window extraction alone
  systematically discards exactly what research is supposed to find — information that's related
  to the query but doesn't share its vocabulary. Fix, per the user's own spec: a local LLM must
  understand and relate each page, one page at a time, nothing accumulated in context, only the
  already-curated info handed back. `packages/obscura-web/src/ollama-client.mjs` — a
  self-contained adaptation of `vkm-spec/src/ollama-client.mjs`'s already-proven pattern (typed
  `OllamaUnavailableError`, structured-output `format`, deterministic-fallback hard invariant;
  read in full before reuse, not assumed), same default model (`phi4-mini:3.8b-q4_K_M`) and host
  (`127.0.0.1:11434`) as `vkm-spec` so both share one daemon. `deepResearch` now runs one
  `checkOllama` per call (not per page); when available, each of the `top_k` fetched pages is
  curated individually via the new `curatePage(markdown, query)` (input capped at 12,000 chars,
  `truncated` reported, never silent) before its full text goes out of scope — never combined
  with another page's text, never returned to the agent, only the curated excerpt is. A single
  page's curation failure degrades only that page to the ADR-0054 heuristic (now itself improved:
  `extractPassage` keeps the paragraph _after_ a keyword match too, since elaboration rarely
  repeats the matched term) — one flaky page never sinks the whole call, and the tool keeps
  working with Ollama absent exactly like it keeps working with obscura/SearXNG absent. Every
  result now reports `extraction: "ollama" | "heuristic"` and `relevant: boolean`. New env vars,
  all optional: `OBSCURA_RESEARCH_OLLAMA=0`, `OBSCURA_OLLAMA_HOST`, `OBSCURA_OLLAMA_MODEL`,
  `OBSCURA_OLLAMA_KEEP_ALIVE`. Zero new npm dependencies (reuses `zod`). 66/66
  `@vkmikc/obscura-web` tests green (19 new).
- **`obscura_research` final result order now trusts Ollama's verdict over BM25.** Found via a
  real (non-mocked) end-to-end run against "bees": `chosen`'s fetch order comes from BM25, which
  is blind to meaning, but the response kept that same order even after a page was actually
  curated — a page Ollama explicitly marked `relevant: false` could still outrank one it
  confirmed `true`, purely because BM25 scored the rejected page's title/snippet text higher.
  `deepResearch` now re-sorts `results` by `relevant` (stable — ties keep their original BM25
  order) after curation. 67/67 `@vkmikc/obscura-web` tests green (1 new, reproduces the ordering
  bug with a keyword-stuffed-but-off-topic page BM25 would otherwise rank first).
- **Write-time hygiene lint (`vault-lint.mjs`): drift now dies at the write path.** A manual
  hygiene pass on a real vault (2026-07-12) found three classes of silent drift no tool prevented
  at the source: 17 observation lines with non-canonical categories (`[DECISIÓN]`, `[LECCIÓN
GENERAL]`, `[regla]` — invisible to `vault_observations(category:'decision')`), 6 broken
  `[[wikilinks]]`, and 18 orphan notes the graph couldn't reach. Every `vault_write_file` /
  `vault_edit_file` / `vault_append_file` now returns `warnings` when the text being written has
  (a) a non-canonical observation category (suggests the canonical one; per-vault extras via
  `memory-schema.json` → `observationCategories`), (b) a `[[wikilink]]` that resolves to no note
  (template placeholders `<…>` exempt), or (c) a NEW knowledge note (PROJECTS/STACKS/PRACTICES/
  RULES) with zero links — orphan at birth. Strictly scoped to the text the call introduces
  (never nags about pre-existing lines), warning-only (never blocks), fail-open (a lint crash
  cannot break a write), and zero schema cost (no new tools, no description growth).
- **Scaffolded vaults are born connected.** `create-vkm-kit`'s `START_HERE.md` now ships a
  "Vault map / Mapa del vault" section wikilinking every note the scaffold creates (MEMORY,
  SESSION_LOG, PRACTICES/\*, RULES/TEMPLATE, `_meta/agent-profiles`) — the hub whose absence let
  the 18-orphan drift accumulate.
- **`vault_audit` no longer flags template placeholders.** `[[PROJECTS/<proyecto>]]` in
  RULES/TEMPLATE is deliberate scaffolding; the broken-link scan now skips `<…>` targets — the
  same exemption the write-time lint applies.
- **`/vkm-design` skill: professional, anti-generic design for any medium (ADR-0053).** Third vkm
  skill installed by `create-vkm-kit`. A designer-cognition core (`references/designer-mind.md`:
  Gestalt, hierarchy-first, process order, crit vocabulary), a mandatory design-direction protocol
  with a banned-by-default "slop fingerprint" (`references/direction.md`), quantified foundations
  (type scales, OKLCH palettes, motion numbers, inline WCAG formula), a live-verified library map
  across web/mobile/desktop/TUI/dataviz (`references/libraries.md` — candidates unversioned, hard
  verify-online rule), four modes (`generate`, `critique`, `visual-loop`, `handoff` with DTCG
  tokens), executable lineage capsules (`references/lineages.md` — real free typefaces + OKLCH
  seeds + shape/motion numbers per design language), a fully worked brief→deliver example with
  real validator output (`examples/worked-example.md`), ceremony scaling (full protocol for new
  surfaces, inherited direction for edits, numbers-only for micro-tasks), and four zero-dep
  validators with CLI exit codes and unit tests: `scripts/contrast.mjs` (WCAG; accepts hex AND
  `oklch()` per CSS Color 4 with gamut-clip detection), `scripts/scale.mjs` (check + `--gen`),
  `scripts/palette.mjs` (gamut-aware OKLCH neutral/accent ramps + semantic ok/warn/danger tokens
  searched to a guaranteed >= 4.5:1 on both surface extremes; `--json` emits DTCG tokens) and
  `scripts/audit-css.mjs` (static stylesheet audit for critique mode: declared color pairs with
  `var()` resolution, font sizes, spacing rhythm — honest static-only scope), plus
  `scripts/slop-check.mjs` (the anti-generic fingerprint mechanized: scans HTML/CSS for
  Inter/Poppins defaults, the indigo/violet family, gradient text, glassmorphism, emoji
  iconography, uniform radii and stock shadows — exit 1 until each hit is justified or
  replaced; measured end-to-end in `evals/design-bench/`). Critique mode also
  gains an "infer the incumbent direction" workflow for edits inside existing systems, and
  `references/marks.md` covers logo/wordmark/favicon craft (construction, optical corrections,
  16px→512px test matrix, SVG hygiene). After user feedback that a gate-passing page can still
  be forgettable, `references/contemporary.md` adds the ceiling: time-stamped award-level
  currents (2026, verified online) as executable recipes with their slop-versions, a "boldness
  budget" (1–2 full-intensity moves per surface, in the first viewport) and the **lineup test**
  (logo hidden, distinguishable from ten templates?) wired as a Major finding in critique, a
  per-iteration check in the visual loop and a hard requirement of the committed direction —
  correct is the floor, memorable is the target. `references/illustration.md` handles any bespoke
  figurative drawing of a real thing (species, product, landmark, mascot): because **hand-plotting
  bézier coordinates cannot depict a complex real subject faithfully** — a model emits the category
  average, so a hand-drawn "guapote" cichlid came out a tuna with every gate green — it teaches a
  technique-matching decision (trace a reference / treat a photo / icon library / hand-draw only if
  abstract), a real tracing pipeline `scripts/trace-svg.mjs` (potrace + jimp: reference → Otsu/
  alpha mask → vector → restyle), and an **IoU fidelity gate** (measured overlap of trace vs
  reference, ship ≥ ~0.7). Proven on `evals/design-bench` "The Cabinet": 7 subjects across 3
  categories traced from CC/CC0 references, IoU 0.66–0.92. `examples/illustration-gallery.md` runs
  the technique choice across 8 subjects; wired as a Major finding in critique/visual-loop and a
  build step in generate. `illustration.md` Step 4 + `foundations.md` add the **mixed-ratio
  alignment** rule: logos/avatars/icons/illustrations of different native aspect ratios in one
  grid render at different sizes and off-centre (a "desfase") — normalize each to a shared box by
  its longest side (`object-fit: contain` for raster; shared square `viewBox` +
  `preserveAspectRatio` for SVG), with `trace-svg.mjs --square` producing grid-ready output at
  trace time. `trace-svg.mjs` also **cleans the mask before tracing** (largest connected
  component + fill-holes + morphological smoothing) so the trace follows the subject's shape, not
  the photo's background grain and interior texture — a raw threshold traces the noise and ships
  a speckled artifact; a cleaned one traces to a single smooth path. Documented limits (both
  caught by the IoU gate): a busy background can't be thresholded, and fill-holes closes
  meaningful holes — so the rule is trace CLEAN references, verify, and drop what won't come out
  faithful rather than ship artifacts. `scripts/treat-photo.mjs` (jimp-only) covers the table's
  other faithful branch — **treat a real photo** with duotone / halftone / cutout when a subject
  has no clean line to trace (fine texture, a portrait): the output IS the photo so it stays
  faithful with full detail, the treatment makes it one system, no trace artifacts. The
  illustration toolkit now matches the decision table end to end: trace a clean reference OR treat
  a photo — both faithful, neither hand-plotted (`evals/design-bench` run 6f). The lineage
  catalog quadrupled (8 → 16 executable capsules: naturalist/field-guide, heritage/workwear, Y2K
  chrome, groovy 70s, sci-fi HUD, Scandinavian folk, collage/zine, soft-dimensional/clay) and the
  contemporary currents grew 10 → 14 (image-treatment-as-identity, sticker/badge layer, giant
  cropped wordmark, custom cursor/selection). Final polish from live A/B feedback: the skill
  declares **no house style** (a model's second-order comfort look — one favourite type pairing/
  colour world reused across briefs — is named in the slop fingerprint), the variety sampler
  forces rotation on five axes (hue, lineage ≠ last build, type pairing, current, **layout
  topology** — the reused header→hero→grid→pricing→giant-wordmark skeleton is called out as
  structural convergence), and `foundations.md` adds "when the image IS the content, show it
  WHOLE" (natural ratio / `contain`, never a cover-crop gallery). `vkm-discipline`'s
  `domains/design-ui.md` stays the acceptance gate and now points to the skill.

- **`vault_delete_file` + `vault_move_file`: note lifecycle lands in the hybrid MCP (17 tools).**
  Until now the vault surface could create and edit notes but never retire or reorganize them —
  deletes/renames meant dropping to the shell (outside the vault lock, no path-escape checks, no
  etag precondition). Both tools run under the advisory write lock with `safeVaultPath` validation
  and opt-in `ifMatch`. Safety rails, chosen so an agent mistake is recoverable and a broken link is
  visible instead of silent:
  - Delete is **soft by default** — the file moves to `.trash/<same relative path>` (Obsidian's
    vault-trash folder, uniquified on collision); `permanent: true` unlinks for real and is the only
    way to remove something already in `.trash/`. Restore is just `vault_move_file` back out.
  - Move refuses an existing destination without `overwrite: true`, creates destination parent dirs,
    and runs the destination-side `memory-schema.json` check like a fresh write there would.
  - Both refuse directories and the core protocol notes (`START_HERE`/`MEMORY`/`SESSION_LOG`/
    `KNOWN_FAILURES`), and neither rewrites `[[wikilinks]]` — the result reports which notes still
    reference the old name (`linkRefs`/`staleLinkRefs`, boundary-checked so `[[typescript-advanced]]`
    never counts for `typescript`) so the agent fixes links deliberately.
  - Schema budget (ADR-0035) raised 8,000 → 9,200 chars in the same change: two destructive-capable
    tools whose rails must be visible in the schema, not discovered by error. Also fixes the stale
    "fourteen tools" count in the stack rule (it was 15 — `assemble_context` was never enumerated).
- **Note-lifecycle tool set completes the hybrid MCP surface (22 tools):** `vault_append_file`,
  `vault_frontmatter_set`, `vault_backlinks`, `vault_git_history`, `vault_rotate_log`.
  - `vault_append_file` — CRLF-aware append (creates if missing, normalizes newlines to the file's
    EOL, guarantees separation): the close ritual's `SESSION_LOG` one-liner no longer needs a read +
    single-line-anchor edit round-trip.
  - `vault_frontmatter_set` — set/remove top-level **scalar** YAML frontmatter keys without
    text-matching (`status: hypothesis→confirmed`, `last_verified`). Creates the block when absent,
    preserves everything else byte-for-byte, refuses nested/multi-line values instead of corrupting
    them, JSON-quotes values YAML could misread.
  - `vault_backlinks` — read-only "who `[[links]]` here" (boundary-checked, self-references
    excluded); the impact check before a delete/move, and it works for already-deleted targets.
  - `vault_git_history` — read-only bridge to the sync repo: a note's commits, or its content at a
    `rev` (strict hash/`HEAD~N` allowlist, never parsed as a git option) — recovery even after
    `permanent: true`. Old content returns inside the untrusted-data envelope like any vault read.
  - `vault_rotate_log` — MCP face of the existing `rotate-log` engine via a new Python
    `json-rotate-log` subcommand (same options, one JSON object out): archive old `SESSION_LOG.md`
    sections keeping the newest N; moves, never deletes; `dryRun` previews. Closes the loop with
    `vault_audit`'s bloat warning in-session.
  - The rotate engine (`rotate.py`) now also rotates **flat bullet logs**: when `SESSION_LOG.md`
    has no `##` sections, top-level `-` bullets (the close ritual's "one line at the end" format,
    indented continuations attached) are the rotation unit; sections still win on mixed files so a
    bullet list inside a section is never rotated on its own. `RotateResult`/`json-rotate-log` gain
    a `mode: "sections" | "bullets"` field. Found live: the shipped vault convention writes bullet
    lines, so section-only rotation was a silent no-op (`sections_total: 0`) on real logs.
    `vault_memory_report`'s recent-activity digest (`reflect.py`) shares the splitter and inherits
    the fallback — a flat bullet log now counts its newest entries instead of reporting zero activity.
  - Schema budget: 9,200 → 10,800 chars (measured 10,622) — five tools at ~320 chars each, already
    trimmed to the load-bearing contract.

- **`npm run preview:assets` — local preview server for theme-aware SVG assets.** Tiny
  dependency-free static server (`scripts/preview-assets.mjs`, `127.0.0.1:4180`) for visually
  verifying `docs/assets/*.svg` in a live browser, where GitHub's `prefers-color-scheme` theming
  actually applies. Exists because agent browser panes commonly block `file://` navigation (hit
  live while QA-ing the hero update). Read-only, GET/HEAD only, localhost-only, traversal-safe,
  never serves dotfiles. Documented in `CONTRIBUTING.md`.

### Changed

- **Docs refresh + restyle across the repo (docs + `--help` text only, no runtime change).**
  Root `README.md`/`README.en.md`: npm / node / platform badges + an at-a-glance suite strip.
  `docs/{es,en}` glossaries: the ten missing 4.x terms added (`vkm-kit`, token-saver,
  `vkm-doctor`, `vkm-spec`, skills, `assemble_context`, knowledge graph, memory report,
  `obscura-web`, SearXNG). `docs/observability.md`: the `vkm-doctor` surface (local OTLP sink on
  `127.0.0.1:4319` → `~/.vkm/telemetry/`, labelled `--include-transcripts` fallback) was entirely
  undocumented — now surface #2, summary table included. `packages/create-vkm-kit/README.md`:
  stale `Vahlame/obsidian-memory-kit` repo URLs fixed, suite paragraph added, Options table
  completed with the twelve missing flags (`--minimal`, `--pin-failures`/`--usage-boost`,
  `--memory-enforcement`, `--effort-gate`, `--token-saver`/`--terse-style`, `--telemetry`,
  `--skills`/`--agents`, `--ollama`, `--uninstall`). New `packages/vkm-doctor/README.md` and
  `packages/vkm-spec/README.md` (neither had one). `docs/README.md` hub: usage / migration /
  glossary links. `--help` drift fixed: the skills paragraph now lists `/vkm-design` (ADR-0053)
  and says "the three skills" (was "the two"). `docs/assets/hero.svg`: new bottom band "Suite de
  eficiencia 4.x" (token-saver, vkm-doctor, vkm-spec, skills, obscura-web) — the hero only told
  the 3.x memory story; same light/dark theming, new accent contrast-checked (5.45:1 light /
  6.95:1 dark), README alt texts updated to match.

## [4.2.0] - 2026-07-12

### Added

- **`obscura_search` gains a local SearXNG structured backend, started on demand (ADR-0052).** Free
  SERP scraping can't be fast + high-volume + relevant at once; a local SearXNG (aggregated engines,
  structured JSON, no anti-bot wall) can. `ensureSearxng()` starts SearXNG the moment `obscura_search`
  needs it and stops it after an idle window (`OBSCURA_SEARXNG_IDLE_MS`, default 90 s) — nothing runs
  in the background while idle — and falls back to the scrape chain when it's unavailable. `searchWeb`
  now defaults to a local instance (`http://127.0.0.1:8888`; `OBSCURA_SEARXNG_URL=""` disables it).
  A reproducible Windows setup (no Docker) ships under `packages/obscura-web/searxng/`
  (`settings.template.yml`, a `pwd` shim, a README); paths are overridable via
  `OBSCURA_SEARXNG_{PORT,PY,SRC,SETTINGS,IDLE_MS,AUTOSTART}`.
- **Desktop monitor for SearXNG (`searxng-gui.pyw`).** A stdlib-only Tkinter app: live up/idle status
  plus a feed of what the agent has searched (each search is appended to
  `~/.vkm/searxng/searches.log`). It only monitors — the MCP owns the on-demand lifecycle, so closing
  the window frees only the window.
- **Domain reference system for `/vkm-discipline` + an `obscura` web-search domain.** Skills can now
  ship on-demand domain reference files: the installer copies a skill's whole directory (not just
  `SKILL.md`), loaded on demand (progressive disclosure). The first is
  `skills/vkm-discipline/domains/web-search.md` — how to search/fetch well through obscura and hand
  back a verified, grounded result (cite only what you fetched, cross-check high-stakes facts,
  match freshness/cache to volatility).
- **Full cross-domain reference set for `/vkm-discipline`, re-authored from the SOP-suite's
  bench-refined annexes in the execution-first voice (deliver-a-better-result checklists + anti-patterns,
  not bureaucratic gates):** `coding`, `debugging` (bugs + live incidents:
  first-hypothesis-is-what-changed, capture before mitigate, SEV cadence, revert-by-default,
  next-update-not-resolution comms), `data` (rehearse destructive DML with a SELECT-count + backup,
  parameterize, validate with aggregates), `infra` (test-env-first, restorable backup, health-check
  baseline, canonical mechanism), `writing` (every claim traceable, run every instruction, recompute
  numbers), `design-ui` (contrast computed per theme, keyboard/focus, ≥24px targets, 200% zoom, the
  three states), `web-search`, `security` (untrusted-input-at-the-boundary, rotate-don't-delete leaked
  secrets, least-privilege, dependency vetting), `llm-artifacts` (model proposes, evidence decides;
  plausibility raises the bar), and `expertise` (separate fact/inference/hypothesis, calibrate
  confidence, steelman the alternative, say what would make you wrong). Ten domains cover the SOP-suite's
  A1–A8 plus web-search and expert judgment — the kit now supersedes the SOP-suite's cross-domain role.

### Changed

- **`/vkm-discipline` reoriented from a coding contract into cross-domain "resourceful execution"
  (begins superseding the SOP-suite's role; ADR-0049 channel).** Infer the real intent, do it the
  best way, deliver more than the literal ask — with minimal friction, depth scaled to task
  difficulty AND model (a smaller model skips long step-by-step reasoning, which measurably hurts it;
  a larger model self-verifies). Bias to action; ask only when the answer changes what you'd do.
  Guardrails (confirm-before-irreversible, injection/untrusted-data scanning, evidence gates) are now
  opt-in modules, off by default — the skill's job is execution, not friction. Installed copy re-synced.

## [4.1.0] - 2026-07-12

### Added

- **obscura-web: opt-in stealth web fetch + robust search via the local obscura headless
  browser (ADR-0051).** New `packages/obscura-web/` MCP server exposes `obscura_fetch` (stealth
  URL fetch/render) and `obscura_search` (SearXNG JSON → obscura-rendered DuckDuckGo/Bing/Brave
  SERP → native fallback), preferred over the native WebFetch/WebSearch (soft enforcement —
  native stays as the fallback). Wired for Claude Code, Codex and Cursor and gated to
  `--obscura`/`--full`; the pinned obscura v0.1.10 binary is downloaded and SHA-256-verified
  into `~/.vkm/obscura/` by `obscura-setup.mjs` (best-effort, opt-in). Fetched pages and result
  snippets are wrapped as untrusted web DATA and injection-flagged.

### Security

- **obscura is a third-party binary the kit runs but cannot audit.** `obscura-setup.mjs` pins
  the version (v0.1.10) and verifies the download's SHA-256 against a baked-in digest (obscura
  ships no checksum file, so the digests are computed by `scripts/obscura-checksums.mjs`); it
  **refuses to run** a download whose hash is unset or mismatched. obscura-web uses per-request
  `obscura fetch` (no persistent server, no open port), spawns with argv only (no shell), and
  accepts only http(s) URLs. The residual supply-chain risk is accepted explicitly.
- **`assemble_context`'s `project` parameter allowed path traversal.** A caller-supplied
  `project` value like `../../../etc/passwd` was joined into a file path with plain
  `path.join` (not `safeVaultPath`, unlike every other tool) and read with no containment
  check or untrusted-data wrapping — reading arbitrary `.md` files off the host. Routed
  through `safeVaultPath` + `wrapUntrusted`; the wire schema also gained a
  `/^[\w-]+$/` regex as defense-in-depth.
- **`create-obsidian-memory-shim` forwarded argv through a shell.** `execa(..., {shell:
process.platform === "win32"})` let cmd.exe interpret `&`/`|`/`>` in any forwarded CLI
  argument — reproduced live (a crafted argument wrote an arbitrary file via an injected
  `echo`). `shell: true` was unnecessary (execa's bundled cross-spawn already resolves
  `npx.cmd` on Windows without one, verified directly) and is now removed.

### Fixed

- **`vault_hybrid_search`'s default path silently ignored the vault's real vector
  index.** `hybrid-search`/`json-hybrid-search` pre-resolved an embedder via
  `get_embedder(args.embedder)` before calling `ensure_fresh`, bypassing its
  on-disk-identity-preference logic entirely — a vault indexed with a non-default
  embedder (e.g. `fastembed:...`) was silently re-indexed and queried under the hashing
  default instead. `memory-report --duplicates`/`memory-reflect` had the same
  split-brain (independently re-deriving the embedder name instead of using what
  `ensure_fresh` actually used, seeing zero rows). `ensure_fresh` now returns
  `FreshStats.embedder_name`; all three call sites thread it through instead of
  re-deriving.
- **`embedder_for_identity` crashed instead of degrading when fastembed wasn't
  loadable** (never installed, extra removed, index moved to a machine without it) —
  every bare `ensure_fresh` caller (search/complete/relations/memory-report/...) would
  crash. Now returns `None` like the hashing branch already did.
- **Default `HashingEmbedder` tokenizer fragmented non-ASCII words** (`[a-z0-9]+,
re.ASCII` split "código" into "c"+"digo") — broken for this kit's primary vault
  language (Spanish). Broadened to Unicode letters+digits, matching the FTS5 channel's
  existing diacritic handling.
- **`guard-effort-gate`'s transcript cache could resume into unrelated bytes.**
  `canResume` checked only size/mtime monotonicity — a transcript truncated and
  replaced with unrelated content, then appended past its original cached size before
  the next call, looked like "just grew" and resumed from the stale offset into the
  middle of the new content. Added a content fingerprint (hash of the bytes just
  before the cached offset), re-verified against the current file before trusting a
  resume.
- **Go daemon: a rejected pre-commit hook was misread as "nothing to commit."**
  `commitStep` treated any `git commit` exit 1 as the benign noop case without
  checking the actual output — a hook rejecting staged content (not an empty commit)
  silently discarded the work while every health signal stayed green. Now checks for
  git's actual noop message text.
- **Go daemon: the cross-process git-sync lock could delete another process's live
  lock.** `release()` removed the lockfile unconditionally; a holder whose lock was
  stolen as stale (e.g. after a clock jump) could delete the NEW holder's lock on its
  own release, opening a window for concurrent git operations against the same
  worktree. `release()` now verifies pid+hostname before removing.
- **Go daemon: rebase-abort only triggered on `CONFLICT`/`needs merge` text**, missing
  failure modes (context-timeout kill, network drop) that leave `.git` mid-rebase with
  no recovery. The trigger now checks the actual on-disk rebase state
  (`.git/rebase-merge`/`rebase-apply`) instead of matching failure text; a FAILED abort
  is recorded distinctly from a successful one (`LastRebaseAbortFailedAt`) so `doctor`
  never reports a still-mid-rebase worktree as resolved.
- **Go daemon: `execRunner.Run` discarded stderr entirely** — `add`/`commit`/push-retry
  failures recorded as a bare exit code with no indication why. Now captured and
  included in the returned error.
- **`assemble_context`'s relevance gate disabled itself on short/vague queries.**
  `anchorTerms` returned an empty list when every query token was under the length
  floor (e.g. "fix bug"), and an empty anchor list was treated as "nothing to filter" —
  admitting every hit unfiltered for exactly the queries most likely to need the gate.
  Falls back to the raw query tokens instead of an empty list. The anchor match itself
  is now word-boundary-aware (a stemmed "statu" no longer substring-matches
  "statue"/"statutory").
- **`vkm-doctor`'s `aggregate()` had no numeric validation** — one malformed NDJSON
  line (torn write, future OTLP schema drift) silently poisoned the running sum to
  `NaN`, collapsing `cacheHitRatio` to `null` ("no data yet") and masking a real
  broken-cache diagnosis. Non-finite values are now skipped, not accumulated.
- **`vkm-doctor`'s OTLP sink and `vkm-spec`'s SSE draft handler had no `'error'`
  listener** on the request/response streams — an unhandled `'error'` event is fatal
  by Node's default, crashing the whole process (every open GUI tab, in the spec-builder
  case) on a single dropped connection. Both now handle the event defensively; the SSE
  handler also stops writing once the client has disconnected instead of writing to a
  dead socket.
- Hook templates written by a fresh install (`_transcript-cache.mjs`,
  `guard-effort-gate.mjs`, `guard-native-memory-write.mjs`,
  `session-start-vault-context.mjs`, `stop-vault-close-reminder.mjs`) only carried the
  legacy `create-obsidian-memory` ownership marker, not `vkm-kit` — a future trim of
  `LEGACY_FILE_MARKERS` (per ADR-0041's own stated timeline) would have silently broken
  `--uninstall` recognition for these exact files on every machine, old and new.
- The interactive wizard coupled telemetry's enable state to the unrelated
  `--no-token-saver` flag — running the wizard with `--no-token-saver` on a machine
  with telemetry already installed silently stripped it. Now independent, matching the
  headless path.
- Stale `create-obsidian-memory` branding in `create-vkm-kit`'s `--help` output and
  banner text (bins are `create-vkm-kit`/`vkm`).
- Frontmatter self-paste guard (`vault_edit_file`) only caught an exact byte-duplicate
  of the original block — a `newText` inserting a _different_ hallucinated frontmatter
  block into the body wasn't caught. Generalized to compare frontmatter-shaped block
  counts in the body, not just occurrences of the original bytes.
- `wrapUntrusted`'s `source` attribute had no quote-escaping (inert on Windows/NTFS,
  which forbids `"` in filenames; a real gap on POSIX).
- `reflect.py`'s `_recent_activity`/`_pending_promotions` scanned raw note text without
  the fence-aware `strip_code_regions` scrub already applied elsewhere — a fenced
  example documenting the tag/wikilink/pending-observation syntax polluted the real
  counts.
- Usage-decay scoring (`usage_counts_decayed`) clamped a future-dated event (clock
  skew) to age 0 — the _maximum_ possible weight — instead of excluding it.
- `_missing_frontmatter_keys` used `a or b` instead of an explicit `in`/`is not None`
  check, so an explicit empty-dict folder rule (`{}`, "no requirement here, override
  the wildcard") was wrongly treated as falsy and fell through to the wildcard anyway.
- Go daemon: `truncate`/`truncateString` sliced by byte index, which can cut mid-rune
  on non-ASCII text (this vault's own content); now rune-safe. `state.json` is now
  written `0o600`, not `0o644` (its error text can include git output, which may embed
  a credential-bearing remote URL).
- `vkm-spec`'s `reviewInEditor` naively split `$EDITOR`/`$VISUAL` on spaces, breaking a
  quoted Windows path (`"C:\Program Files\...\code.exe"`) and silently swallowing the
  resulting failure. Now parses a leading quoted command and surfaces a warning when
  the editor can't be launched.
- `vkm-spec`: an EADDRINUSE reuse of an already-running instance now checks a new
  `GET /api/health` endpoint and warns on a version mismatch (the desktop-shortcut
  zombie-process-after-update failure mode) instead of assuming the existing instance
  is fine.

## [4.0.0] - 2026-07-10

The kit becomes **vkm-kit**: one plug-and-play efficiency suite for Claude Code —
persistent vault memory + token-saver + local usage doctor + spec-builder. The
repo is now `Vahlame/create-vkm-kit`; the installer package is
`@vkmikc/create-vkm-kit` (bins `create-vkm-kit` and `vkm`), and the old
`@vkmikc/create-obsidian-memory` name lives on as a forwarding shim — see the
migration notes in ADR-0041/0050. Machine identifiers your installs depend on
are FROZEN: the MCP server key `obsidian-memory-hybrid`, the `obsidian-memoryd`
daemon, and `BASIC_MEMORY_HOME`. Managed blocks and hook files written by 3.x
are recognized and migrated in place on the next install (dual-read markers,
`vkm-kit:start/end` sentinels, `VKM_VAULT` env accepted alongside the legacy
names).

### Changed

- **Rename (ADR-0041):** `packages/create-obsidian-memory` →
  `packages/create-vkm-kit`; ownership marker `vkm-kit` (legacy
  `create-obsidian-memory` still recognized); managed-block sentinels
  `<!-- vkm-kit:start/end -->` with in-place migration of legacy blocks
  (test-pinned); `VKM_VAULT` accepted before `BASIC_MEMORY_HOME` /
  `OBSIDIAN_MEMORY_VAULT`; release workflow publishes the renamed installer
  plus the shim.

### Security

- **RAG-passthrough MCP tools no longer accept a caller-supplied `vault` path.**
  `vault_hybrid_search`, `vault_fts_search`, `vault_fts_index`, `vault_complete`,
  `vault_relations`, `vault_observations`, `vault_kg_suggest`,
  `memory_extract_candidates`, `vault_audit`, and `vault_memory_report` exposed
  an optional `vault` parameter with no validation against the configured
  default — a prompt-injected note could coerce an agent into pointing one of
  these tools at an arbitrary directory on disk, indexing and searching its
  `.md` files (a cross-directory read oracle) and creating a
  `.obsidian-memory-rag/` sidecar there. Removed the parameter from all 10
  tool schemas, matching the posture the filesystem tools (`vault_read_file`,
  `vault_write_file`, `vault_edit_file`, `vault_list_directory`) already had.
  See ADR-0040.

### Added

- **`vkm-spec` package (ADR-0046/0047/0048)** — the spec-builder pipeline: a one-line
  idea + vault context (one `assembleContext` call) compiles into an editable
  `<orchestration_package>` XML prompt, optionally enriched by a LOCAL Ollama
  draft (`phi4-mini:3.8b-q4_K_M`, `/api/chat` with `format=<JSON schema>`
  constrained decoding, fetch-only client, typed failures) — then reviewed by
  the human (GUI on `127.0.0.1:4923` with an SSE draft stream and a visible
  ollama/fallback source badge, or `vkm-spec` CLI with `$EDITOR` review) and
  pasted into Claude Code / Claude web / any AI. The deterministic fallback is
  structural: `buildSpec` always compiles a working prompt and the LLM draft
  only overwrites fields on success — pinned by a degradation-gate test (Ollama
  down → SSE `error` frame still carries a working XML). The installer can
  auto-provision Ollama + the model under explicit `--full` or `--ollama`
  (winget silent on Windows, ~2.3GB pull, best-effort — never `curl|sh`, never
  a surprise download on a bare install; `--no-ollama` opts out).

- **vkm skills + subagent template (ADR-0049)** — `/vkm-discipline` (execution
  contract: same functionality and quality in fewer readable lines — density,
  never reduced scope; vault-first context via one `assemble_context` call;
  terse output; nothing is "done" without executed evidence) and `/vkm-spec`
  (turn a one-line idea into a precise, context-grounded spec in-session — no
  local LLM in the synchronous path) installed into `~/.claude/skills/`, plus
  the `vkm-implementer` subagent template in `~/.claude/agents/`. All
  hash-tracked (`--skills` / `--agents` toggles; user-modified files survive
  uninstall), with a lint gate keeping every skill description ≤300 chars. The
  managed rules block gains one "Executable discipline (vkm)" bullet (ES/EN,
  within existing budgets; AGENTS.md + install docs re-synced — drift gates
  green).
- **`assemble_context` MCP tool (ADR-0045)** — one call returns a budgeted context
  bundle for a task (typed `[decision]`s from the project note, non-decision
  observations + relevant cross-note passages, `#stack` facts, and a raw-note
  fallback excerpt when a project has no typed decisions yet), replacing the
  3-6 discrete search/read round-trips an agent would otherwise chain. Engine
  relocated from the prompt-compiler's `context-search.mjs` into
  `obsidian-memory-mcp/src/context-assemble.mjs` (parallel `json-hybrid-search
--graph` + two `json-observations` passes over the same Python bridge).
  Honors the security posture of every RAG tool: no wire-level `vault` param
  (env-resolved only, pinned by test), untrusted-data `_trust` envelope with
  injection flagging, and a `budget_chars` cap (default 6000) that trims
  passages-first so decisions survive longest. Measured and CI-locked by the
  new `bench-assemble` gate (`--assert-savings 0.60 --assert-answered 0.90`):
  on the labelled fixture, median 68% fewer wire tokens than the naive
  multi-call pattern at 100% completeness (10,867 vs 30,816 tokens aggregate;
  cross-cutting queries save an honest 45%, project tasks 68% — and the naive
  arm pays no discovery cost, so these are floors).
- **`vkm-doctor` package + local telemetry (ADR-0044)** — a zero-dependency local
  OTLP/HTTP JSON sink (`vkm-otel-sink`, 127.0.0.1:4319 → NDJSON rollups in
  `~/.vkm/telemetry/`, 90-day prune, lockfile singleton, tolerant parser that
  archives unknown metric shapes instead of dropping them) plus a `vkm-doctor`
  CLI that reports token usage per day/model/type, the cache-hit ratio, cost,
  and a "broken cache" diagnosis (high input volume with near-zero cacheRead).
  The installer wires Claude Code's OTEL export to the sink (managed `env`
  block; `--no-telemetry` opts out) and a `SessionStart` hook spawns the sink
  when it isn't running — no OS service. Local only: nothing leaves the
  machine. Transcript scanning exists only as a clearly-labeled
  `transcript-estimate` fallback (the JSONL format is officially unstable).
- **Token-saver module (ADR-0043) in `create-obsidian-memory`** — on by default for
  Claude Code installs (`--no-token-saver` / `--no-terse-style` opt out;
  `VKM_TOKEN_SAVER=0` is a runtime kill switch). Three pieces, all reconciled
  symmetrically and fully reversed by `--uninstall`: (1) a `PostToolUse` hook
  (matcher `Bash`) that compacts noisy shell output before it enters context —
  ANSI stripped, `\r` progress repaints reduced to their final frame, runs of
  identical lines collapsed, >200-line logs windowed to head+tail — while a
  hard, test-gated guarantee keeps every error/warn/fail/exit-code line and the
  final lines verbatim (≥30% reduction on the noisy CI fixture, zero
  diagnostic loss); (2) a `PostToolUse` hook (matcher `mcp__.*`) that
  re-serializes pretty-printed JSON tool results into compact form
  (whitespace-only — parsed data, including the `_trust` envelope, is
  byte-identical after `JSON.parse`); (3) `permissions.deny` read rules for
  token-hungry artifacts (`node_modules/**`, `**/dist/**`, lockfiles) plus the
  `vkm-terse` output style (`keep-coding-instructions: true`), installed
  hash-tracked and activated via the `outputStyle` setting.
- **Shared settings-write infrastructure (`settings-io.mjs`, `settings-writers.mjs`,
  `asset-install.mjs`) in `create-obsidian-memory`** — Phase 0 groundwork for the
  vkm-kit efficiency-suite train. The safe `~/.claude/settings.json` idiom
  (read→BOM-strip→parse with invalid-JSON backup, pure managed-hook merge/remove
  deduped by filename stem, JSON sanity parse, restricted backups, atomic
  tmp+rename writes, ownership-marker checks) is extracted out of
  `claude-native-memory.mjs` into `settings-io.mjs` — behavior unchanged, existing
  suite as the refactor guard — and joined by new pure writers for the sections
  upcoming modules manage (`env`, `permissions.deny/allow`, `outputStyle`;
  removal only reverses values still provably ours) plus a managed-asset
  installer that tracks installed template files by SHA-256 in a
  `~/.claude/vkm-kit.assets.json` sidecar so uninstall deletes only unmodified
  files.
- **Cross-process lock for the Go daemon's git-sync.** Two `obsidian-memoryd`
  instances (or a daemon plus a manual `sync once`/git operation) pointed at
  the same vault could previously race `add`/`commit`/`pull`/`push` against
  the same working tree. See ADR-0040.
- **`create-obsidian-memory --uninstall`.** Fully reverses this kit's
  Claude Code integration (hook entries, `autoMemoryEnabled` override, and the
  hook script files it owns) without touching a user's own unrelated hooks or
  same-named files. Turning an enforcement flag off on a re-run
  (`--no-effort-gate`, `--no-memory-enforcement`, `--no-native-memory-override`)
  now also removes the corresponding previously-installed hook instead of
  leaving it active. See ADR-0040.

### Removed

- **`obsidian-prompt-compiler` package (ADR-0046)** — absorbed into `vkm-spec`.
  Its pure modules (`compile-xml`, `prompt-defaults`, `project-resolve`,
  `clipboard`, `review`) moved verbatim; its retrieval was already relocated to
  `obsidian-memory-mcp/src/context-assemble.mjs` (ADR-0045). The GUI moved off
  port 4317 (OTLP collision) to 4923.

### Fixed

- **Go daemon `doctor` could report healthy while actually blind.** A failed
  `git add`/`commit`/`pull` (not just `push`) now feeds the same health state
  `doctor` alarms on; a repeated `rebase --abort` now feeds the alarm too
  (previously only displayed, never alarmed); a silently-failing filesystem
  watcher startup (`fsnotify.NewWatcher`) now sets an immediate alarm instead
  of leaving the daemon looking idle-but-fine with a heartbeat that never
  starts; a sync aborted by intentional shutdown (Ctrl-C / service stop) no
  longer counts toward the "vault not syncing" alarm; `doctor`'s unpushed-
  commit git call now has a timeout like every other git call in the file,
  instead of being able to hang forever.
- **Go daemon push retries now re-pull first.** A push rejected because the
  remote advanced was retried identically on every attempt with no chance of
  succeeding; retries now re-pull/rebase before retrying the push.
- **`doctor`'s exit code / output ordering under the shipped `-H windowsgui`
  build.** Root-caused to PowerShell not waiting for a GUI-subsystem child
  process unless its output is redirected (not fixable from inside the
  process) — documented the correct invocation pattern
  (`docs/en/troubleshooting.md`, `docs/es/troubleshooting.md`,
  `docs/observability.md`) and added a defensive writer flush before `doctor`
  returns.
- **`obsidian-memoryd inspect --last -5` no longer panics** on a negative
  line count.
- **`vault_complete` and `memory_extract_candidates` results now carry the
  same untrusted-data envelope as every other RAG tool** — both previously
  returned vault-derived content (autocomplete matches, memory-dedup
  snippets) with no `_trust`/injection-flagging, unlike `vault_hybrid_search`
  and friends.
- **No subprocess timeout on the MCP↔Python RAG bridge.** A hung/misbehaving
  Python backend could previously block an MCP tool call (and leak the
  process) indefinitely; configurable via `OBSIDIAN_MEMORY_RAG_TIMEOUT_MS`
  (default 120s).
- **Claude Code hook commands no longer corrupt on vault paths containing a
  quote or a trailing backslash.** Switched from an interpolated shell string
  to Claude Code's exec form (`command` + `args` array), which eliminates the
  escaping bug class entirely rather than patching it.
- **Hook transcript scans are now incremental.** `guard-effort-gate` and
  `stop-vault-close-reminder` used to re-read and re-parse the entire session
  transcript on every gated event (measured ~75ms on a 25MB transcript,
  compounding across a long session); they now cache the last-scanned offset
  and only read the new suffix, falling back to a full rescan on any doubt.
- **Backup files (`.bak.*` of `settings.json`/`mcp.json`) are now actually
  permission-restricted on Windows.** The existing `chmod 0600` protection was
  unconditionally skipped on `win32` — the platform this repo is chiefly used
  on — despite the code's own stated intent of protecting files that may
  contain tokens. Now applies an equivalent `icacls` ACL restriction.
- **`vault_complete`'s autocomplete no longer surfaces tags found inside
  fenced code blocks.** A note documenting `#tag` syntax inside a code fence
  polluted the autocomplete trie with the example text as if it were a real
  tag.
- **Usage-boost retrieval scoring no longer lets stale-but-in-window usage
  permanently outrank a new note.** The `usage` lever (ADR-0038) counted a use
  fully anywhere inside its 90-day window and not at all outside it; it now
  weights each use by recency-decay before scoring, closer to the lever's
  original "recent activity should matter more" intent.
- **A vector index built with one embedder no longer silently grows a second,
  redundant index under another.** Every RAG CLI call that didn't pass an
  explicit `--embedder` resolved one independent of whatever embedder had
  actually built the existing on-disk index; it now reuses the on-disk
  identity when the caller passed no explicit override.
- **`memory-report --duplicates`/`memory-reflect` no longer report "zero
  near-duplicates" indistinguishably from "duplicate detection was skipped."**
  Above the 1500-note pair-comparison cap, the scan now signals that it was
  skipped instead of returning a bare empty result.

See ADR-0040 for the design-level decisions in this pass (cross-process lock,
MCP wire-schema lockdown, hook exec-form, installer uninstall symmetry,
incremental transcript cache, Windows ACL backup protection, usage-decay
scoring, embedder-identity reuse).

## Earlier releases

**3.15.0 and earlier** live in [`docs/changelog/pre-4.0.md`](docs/changelog/pre-4.0.md) —
same text, same format, moved out in 5.0.0 to keep this file readable.

[Unreleased]: https://github.com/Vahlame/create-vkm-kit/compare/v5.2.0...HEAD
[5.2.0]: https://github.com/Vahlame/create-vkm-kit/compare/v5.1.0...v5.2.0
[5.1.0]: https://github.com/Vahlame/create-vkm-kit/compare/v5.0.0...v5.1.0
[5.0.0]: https://github.com/Vahlame/create-vkm-kit/compare/v4.7.1...v5.0.0
[4.7.1]: https://github.com/Vahlame/create-vkm-kit/compare/v4.7.0...v4.7.1
[4.7.0]: https://github.com/Vahlame/create-vkm-kit/compare/v4.6.0...v4.7.0
[4.6.0]: https://github.com/Vahlame/create-vkm-kit/compare/v4.5.1...v4.6.0
[4.5.1]: https://github.com/Vahlame/create-vkm-kit/compare/v4.5.0...v4.5.1
[4.5.0]: https://github.com/Vahlame/create-vkm-kit/compare/v4.4.0...v4.5.0
[4.4.0]: https://github.com/Vahlame/create-vkm-kit/compare/v4.3.0...v4.4.0
