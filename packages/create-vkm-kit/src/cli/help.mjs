/**
 * The `--help` usage page.
 *
 * It was a 190-line template literal in the middle of `main()`, which is how it drifted
 * from what the installer actually does. Out here it is reviewable as prose, and
 * `test/help-text.test.mjs` pins the claims that can be checked against code.
 *
 * English only, deliberately: a flag name is not translated, and neither is the sentence
 * describing it. `--lang` selects the language of the WIZARD and of the scaffolded
 * vault's notes (see `src/i18n.mjs`), not of this page.
 *
 * @module
 */

/** The full usage page, exactly as `--help` prints it. */
export const HELP = `Usage: create-vkm-kit [vault] [options]

Examples:
  create-vkm-kit                 # interactive wizard (pre-selects everything)
  create-vkm-kit ./my-vault -y   # headless, FULL stack by default, into ./my-vault
  create-vkm-kit -y              # headless, FULL stack, default vault path
  create-vkm-kit -y --minimal    # headless, plain basic-memory only

The install is the FULL stack BY DEFAULT (hybrid + semantic + index + sqlite-vec +
rules); run it from a clone of the kit (or pass --repo-root) for the hybrid pieces —
it degrades to basic-memory (no abort) when no clone is found. Use --minimal for plain
basic-memory, or --no-<piece> to drop one part.

Interactive (default):
  --lang en       English prompts
  --dry-run       Show what would be written (no writes)

Feature set:
  --full, --all   Alias for the default full stack PLUS --ide codex,claude (implies -y).
                  Since the full stack is now the default, --full mainly flips the IDE
                  default to codex,claude. Opt out of a piece with --no-semantic /
                  --no-vec / --no-pin-failures / --no-usage-boost / --no-build-index /
                  --no-install-backend / --no-rules.
  --minimal       Opposite of the default: install plain basic-memory only (no hybrid,
                  semantic, index, vec, or rules). Re-add one piece with --with-hybrid /
                  --semantic / --vec / --build-index / --install-backend / --rules.

Headless (CI / scripts) — add -y (aliases: --yes, --non-interactive):
  [vault]         Vault path as the first argument (or --vault <path>); defaults to
                  ~/Documents/obsidian-memory-vault and is created if it doesn't exist.
  --ide <list>    IDEs to wire, comma-separated: codex, claude, cursor (default: cursor;
                  with --full: codex,claude,cursor). codex uses the Codex CLI (codex mcp add →
                  ~/.codex/config.toml); claude uses the Claude Code CLI (claude mcp add
                  -s user); cursor writes ~/.cursor/mcp.json + ~/.cursor/hooks.json +
                  ~/.cursor/skills + ~/.cursor/rules.
  --no-cursor-mcp Skip writing ~/.cursor/mcp.json
  --no-git-init   Skip git init when .git is missing
                  (Merges kit Git/SCM keys into <vault>/.vscode/settings.json — creates or updates.)
  --with-hybrid   Also wire obsidian-memory-hybrid (needs kit clone; use --repo-root or cwd walk)
  --repo-root <path>  Root of vkm-kit clone (hybrid bridge + Python src)
  --semantic      With --with-hybrid: neural embeddings (fastembed multilingual; needs the [semantic] extra)
  --vec           With --with-hybrid: sqlite-vec acceleration (needs the [vec] extra; sets
                  OBSIDIAN_MEMORY_SQLITE_VEC=1). Ranking-identical, safe fallback. On under --full.
  --rerank        With --with-hybrid: cross-encoder reranker (installs the [rerank] extra;
                  sets OBSIDIAN_MEMORY_RERANK=1). Opt-in only (downloads a model on first use;
                  uses the multilingual default) — NOT enabled by --full.
  --pin-failures  With --with-hybrid: resurface recorded KNOWN_FAILURES lessons on matching
                  tasks (sets OBSIDIAN_MEMORY_PIN_FAILURES=1; ADR-0038). ON by default;
                  opt out with --no-pin-failures.
  --usage-boost   With --with-hybrid: boost notes the agent demonstrably used, from the
                  local recall_log telemetry (sets OBSIDIAN_MEMORY_USAGE_BOOST=1; ADR-0038).
                  ON by default; opt out with --no-usage-boost.
  --postgres      Postgres projection of the vault memory (vkm-memory-pg): embedded PGlite
                  by default, a localhost-only HTTP service with real-time graph, timeline,
                  search and live events. ON by default (needs a kit clone; sets VKM_PG=1
                  on the hybrid MCP, starts the local pg-service, runs the initial full
                  sync, and installs a SessionStart keep-alive hook). The vault stays the
                  source of truth — the projection is disposable and rebuildable.
  --no-postgres   Skip the Postgres projection (a re-run also removes the keep-alive hook).
  --pg-dsn <dsn>  Point the projection at an EXTERNAL Postgres server (connection string;
                  sets VKM_PG_DSN) instead of the embedded PGlite datadir.
  --console       Build the vkm-console terminal UI (Go) into <kit>/bin — a live view over
                  the pg-service (activity, graph, search); the summary prints the binary
                  path and usage. Opt-in; ON under --full; needs Go on PATH.
  --no-console    Skip the console build (wins over --console and --full).
  --build-index   After wiring, build the local FTS (+semantic) index (needs the Python backend)
  --install-backend  pip install -e the Python RAG backend (best-effort; on by default under --full)
  --with-gitleaks Install gitleaks pre-commit hook in <vault>/.git/hooks/
  --rules <list>  Install the memory-rules block into agent configs: claude
                  (~/.claude/CLAUDE.md, global), codex (~/.codex/AGENTS.md, global),
                  agents (./AGENTS.md), cursor (.cursor/rules/obsidian-memory.mdc).
                  Or 'all' / 'none'. Headless installs rules by DEFAULT (for each wired
                  agent); pass --no-rules or --minimal to skip, or --rules <list> to
                  choose. Interactive asks (deriving from --ide). Idempotent marked block
                  (obsidian-memory:start/end) — never clobbers content.
  --no-rules      Don't write any rules file.
  --rules-profile <minimal|standard|full>
                  WHICH rule levels go in the block (ADR-0067). The block is a
                  permanent prior on every session, so it is split by what each part
                  earns its place with:
                    core      always — memory precedence, the untrusted-data boundary,
                              "if no MCP answers, say so", and the arbitration rule.
                    memory    the protocol proper: recall, close ritual, which tool,
                              what is worth saving. Without it the tools are wired and
                              the model is never told when to use them.
                    doctrine  general working style (terseness, self-check, coaching,
                              model adaptation). Real value, but a prior on ALL work,
                              not memory protocol.
                  full (default) = all three · standard = core+memory ·
                  minimal = core only — the documented KILL SWITCH when the kit's
                  style is getting in the way of your work. Reinstalling with a
                  different profile rewrites the managed block in place.

Claude Code native-memory override (when --ide includes claude):
  By default a Claude Code install also DISABLES Claude's native per-project
  auto-memory (writes "autoMemoryEnabled": false into ~/.claude/settings.json) and
  installs a SessionStart hook (~/.claude/hooks/session-start-vault-context.mjs)
  that injects the vault map + "vault is the only source of truth" reminders. This
  makes the Obsidian vault win over the native memory out of the box (ADR-0029).
  Idempotent (merges settings.json; never duplicates the hook). --minimal opts out.
  --native-memory-override     Force it on (even under --minimal).
  --no-native-memory-override  Leave Claude's native auto-memory untouched.

  Deterministic enforcement (ADR-0030, on by default with the override above) — makes
  the doctrine real for ANY model, old or new, not just ones that reliably read prose
  rules: a PreToolUse hook DENIES Write/Edit/MultiEdit/NotebookEdit into the native
  auto-memory directory, and a Stop hook nudges the close ritual once per turn when the
  session did substantive file work but never touched the vault.
  --memory-enforcement         Force the two enforcement hooks on (even under --minimal).
  --no-memory-enforcement      Keep autoMemoryEnabled:false + SessionStart, skip the
                                PreToolUse guard and Stop nudge.

  Effort advisor (ADR-0081, previously the "effort gate"; on by default with the override
  above, independent of the enforcement pair) — right-sizes your sessions WITHOUT ever
  interrupting one. A PreToolUse hook scores the work it can see (which files, which
  paths, how many, how big, and which way your own words push the stakes), writes the
  effort level it calls for into ~/.claude/settings.json so the NEXT session starts there
  — cheap when the work is simple, strong when it is not — and tells YOU once per session
  via a status line that never reaches the model: zero tokens, zero pauses, structurally
  incapable of blocking an autonomous run (no code path emits a permission decision).
  The first substantive edit is always free, sub-agents are exempt, and it never selects
  fable or overrides a session already on it.
  --effort-gate                Force the effort-advisor hook on (even under --minimal).
  --no-effort-gate             Keep the override (+ enforcement, if on) without the
                                effort-advisor hook.
  Runtime switches (no reinstall): VKM_EFFORT_GATE=0 disables it; VKM_EFFORT_ALLOW_HAIKU=1
  lets it propose a cheaper model, not just a stronger one; VKM_EFFORT_APPLY=keys lets it
  APPLY /model + /effort by typing them into the session — over the DevTools protocol when
  the app was started by scripts/claude-desktop-debug.ps1 (works while you are in another
  window), otherwise only while the Claude window is already in front. It never takes your
  foreground; a decision it could not apply is retried on later edits.

  Token-saver (ADR-0043, on by default when --ide includes claude) — cuts token spend
  with zero quality loss: two PostToolUse hooks compact noisy tool output before it
  enters context (Bash/BashOutput: ANSI/progress/dup-line cleanup + head/tail windowing
  that HARD preserves error/warn/fail lines; mcp__.*: whitespace-only JSON compaction) and the
  vkm-terse output style (~/.claude/output-styles/vkm-terse.md, activated via the
  outputStyle setting). Runtime kill switch without uninstalling: VKM_TOKEN_SAVER=0.
  The permissions.deny rules older versions installed were retired (ADR-0043 amendment);
  any run now removes them from ~/.claude/settings.json.
  --token-saver                Force it on (even under --minimal).
  --no-token-saver             Skip/remove hooks + style.
  --terse-style                Force just the output style on.
  --no-terse-style             Keep the hooks but not the output style.

  Codex hooks (on by default when --ide includes codex) live in ~/.codex/hooks.json:
  SessionStart injects vault context; PreToolUse protects generated local memories and
  runs the effort advisor; PostToolUse returns compacted feedback for noisy shell/MCP output.
  Codex does not currently support updatedMCPToolOutput, so the token-saver cannot mutate
  tool_response in place.
  --codex-hooks / --no-codex-hooks       Force on / remove all Codex-native pieces.
  --vault-context-hook / --no-vault-context-hook  Force on / remove SessionStart context.
  --memory-enforcement / --no-memory-enforcement  Also controls Codex's memory guard.
  --effort-gate / --no-effort-gate       Also controls Codex's PreToolUse effort advisor.
  --token-saver / --no-token-saver       Also controls Codex's PostToolUse token-saver.

  Cursor hooks (on by default when --ide includes cursor) live in ~/.cursor/hooks.json
  (schema version 1) with scripts under ~/.cursor/hooks/:
  sessionStart injects vault context; afterFileEdit + afterMCPExecution track work for the
  stop close-ritual nudge; afterMCPExecution also runs the MCP JSON token-saver. Cursor has
  no Claude native-memory directory and no /effort harness — those Claude-only hooks are
  not ported. Same shared flags as Codex for the overlapping pieces.
  --cursor-hooks / --no-cursor-hooks     Force on / remove all Cursor-native hooks.
  --vault-context-hook / --no-vault-context-hook  Also controls Cursor's sessionStart.
  --memory-enforcement / --no-memory-enforcement  Also controls Cursor's stop nudge + trackers.
  --token-saver / --no-token-saver       Also controls Cursor's afterMCPExecution compact.

  Local telemetry + doctor (ADR-0044, on by default when --ide includes claude and a kit
  clone is available) — wires Claude Code's OTEL metrics export to a LOCAL sink
  (127.0.0.1:4319 → ~/.vkm/telemetry/, nothing leaves the machine) via a managed env
  block + a SessionStart hook that spawns the sink. Run \`vkm-doctor\` for token usage,
  cache-hit ratio and a broken-cache diagnosis.
  --telemetry / --no-telemetry Force on / remove.

  Skills + subagent (ADR-0049/0053/0056, on by default when --ide includes claude, codex, or cursor):
  /vkm-discipline (dense minimal-line code at full quality + verification contract),
  /vkm-spec (idea → precise spec via one assemble_context call), /vkm-design
  (professional anti-generic design: direction before pixels, computed checks, visual
  loop), /vkm-research (consolidate a RESEARCH/<topic> bank into a quality summary.md,
  wikilinks + supersedes), /vkm-verify (prove a green check ran, covered the change and
  can fail — negative control via prove-it.mjs), /vkm-intake (restate objective/
  deliverable/non-goals + image inventory + minimal context BEFORE executing), /vkm-ui-judge
  (measured GUI judgment: live-page Playwright audit for web, flutter_test a11y gates for
  Flutter, screenshot-evidence loop for other native UIs), /vkm-seo (measurable SEO:
  semantic query-family coverage + static before/after audit via seo-audit.mjs), and the
  vkm-implementer agent
  template. Claude uses ~/.claude/skills + ~/.claude/agents/vkm-implementer.md; Codex uses
  ~/.agents/skills + ~/.codex/agents/vkm-implementer.toml; Cursor uses ~/.cursor/skills
  (no agent template — Cursor Task types are a different format). Hash-tracked files;
  uninstall never deletes one you edited. Which one fits which situation:
  docs/en/skills-guide.md (ES: docs/es/guia-de-skills.md).
  --skills / --no-skills       Force on / remove the eight skills.
  --agents / --no-agents       Force on / remove the subagent template (claude/codex only).
  --skills-dir <path>          ALSO copy the skills into any other client's skills folder
                                (Kimi Code, opencode, ...) — additive, independent of
                                --ide; plain markdown + portable Node scripts. Re-run with
                                the same path to update; user-edited files are kept.

  Obscura web (ADR-0051, opt-in via --obscura or --full) — routes web access through the
  local obscura headless browser (anti-detection) instead of the native tools: an MCP
  (obscura-web) exposing eight tools — obscura_fetch / obscura_fetch_many (stealth URL
  fetch, single/batch), obscura_search (SearXNG JSON → obscura-rendered multi-engine SERP →
  native fallback), obscura_research + obscura_research_start/status/stop (local deep-crawl,
  foreground or background job — ADR-0054/0060) and obscura_consolidate (distill persisted
  research into a draft summary — ADR-0056). Soft enforcement — obscura is
  preferred, native WebFetch/WebSearch stay as the fallback. The pinned obscura binary is
  downloaded + SHA-256-verified into ~/.vkm/obscura/ (needs a kit clone for the MCP bridge).
  --obscura / --no-obscura     Install + wire obscura-web (on under --full) / skip it.
  --searxng-url <url>          Point obscura_search at a SearXNG JSON instance (e.g.
                                http://127.0.0.1:8888) for the most robust, structured layer.
  --obscura-research-dir <dir> Override OBSCURA_RESEARCH_DIR (default <vault>/RESEARCH) — root
                                obscura_research({persist:true})/obscura_consolidate write under
                                (ADR-0056).

  Downloads (ADR-0058, opt-in via --downloads only — deliberately NOT in --full, since it writes
  files to disk) — a guarded file-download manager MCP (vkm-downloads) exposing six tools:
  download_resolve (metadata only, no write), download_file (streams to ~/Downloads/vkm-kit/),
  probe_mirrors (rank candidate mirrors, no write), and download_start/status/cancel
  (background jobs for large files — ADR-0059). http(s) only;
  URLs resolving to private/loopback addresses are refused; a 500MB cap aborts oversize files
  mid-stream; downloaded files are never opened or executed. Pure stdlib (no binary to install);
  needs a kit clone for the MCP bridge.
  --downloads / --no-downloads Wire vkm-downloads / skip it (default off; not enabled by --full).
  --download-dir <dir>         Override VKM_DOWNLOAD_DIR (default ~/Downloads/vkm-kit).

  Self-update (ADR-0061) — checks/refreshes the skill + subagent template assets this kit
  manages under Claude and Codex skill/agent/hook locations (the same set --skills/
  --agents/--codex-hooks install), plus reports whether a newer create-vkm-kit is on npm. Safety contract in one
  sentence: files you edited are never overwritten without --force.
  --check-update  Read-only: prints the installed and npm-latest versions (offline/registry
                  failure prints an honest "skipped" line, never an error) and a summary of
                  which managed files are up to date, missing, or locally modified. Writes
                  nothing; always exits 0 — a version check must never fail a script.
  --update        Applies the plan --check-update reported: installs the managed files that are
                  missing or that this kit has changed since your install. Any file whose
                  content YOU changed is left untouched and listed by name at the end —
                  whether or not the kit also changed it. Combine with --force to reset those
                  files to the versions this kit ships (this DISCARDS your local edits to
                  them), or with --dry-run to preview the whole plan with no writes.

  Windows: no console window may appear while the agent works in the background (ADR-0078).
  --windows-audit Read-only check that every kit-owned hook and MCP server — in Claude's
                  settings.json and .claude.json, Codex's config.toml and Cursor's mcp.json —
                  starts through vkm-runhidden.exe. Exits 1 and names each entry that does
                  not, because the fallback to plain node is silent by design and a machine
                  that flashes consoles looks identical to one that does not.
                  Add --fix to rewire the JSON surfaces (your own servers and hooks are never
                  touched; Codex's TOML is reported, not rewritten). Add --watch <seconds> to
                  MEASURE instead: it samples the foreground and prints console_steals, so
                  "no windows appear" stops being a claim and becomes a number.

  Uninstall: --no-native-memory-override / --no-memory-enforcement / --no-effort-gate on a
  re-run now ACTIVELY REMOVE the matching pieces this kit previously installed (not just
  skip adding them) — a symmetric install/remove path, so toggling a flag off actually
  reverses a prior toggle-on. For a full teardown of everything this kit's Claude Code and
  Codex integrations installed in one shot, use:
  --uninstall     Remove all 8 managed hook entries + the autoMemoryEnabled override and
                  the OTLP env block from ~/.claude/settings.json; clear the managed
                  outputStyle; delete the hook script files this kit installed under
                  ~/.claude/hooks/ (the 8 hooks + a small shared helper module), the
                  installed skills and subagents, and the Windows hook launcher at
                  ~/.claude/bin/. Every file is deleted only if a marker or hash check
                  confirms this kit wrote it — never a user's own same-named file. Does
                  The equivalent Codex teardown removes only vkm-kit hook entries from
                  ~/.codex/hooks.json plus hash-tracked Codex skills, agent and hooks;
                  user entries and locally edited assets remain untouched. Does NOT touch MCP server
                  registrations, the vault, or rules blocks — see
                  docs/en/faq.md for those. Combine with --dry-run to preview. Exits
                  immediately after (no other install steps run).

  --version, -v   Print the installed kit version and exit

  --help          This message`;

/** Print the usage page to stdout. */
export function printHelp() {
  console.log(HELP);
}
