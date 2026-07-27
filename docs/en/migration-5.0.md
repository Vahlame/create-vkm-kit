> [🇪🇸 Español](../es/migracion-5.0.md) · 🇬🇧 English

# Migrating from 4.x to 5.0

**Short version:** run the installer once with the same flags you used before, and restart
every editor session. Your vault, your MCP server ids, your environment variables and your
`CLAUDE.md` are untouched by design — [ADR-0079](../adr/0079-naming-and-compatibility-tiers.md)
freezes all of them.

```bash
npx @vkmikc/create-vkm-kit@latest --full
```

Read [Step 1](#step-1-close-every-editor-session-first) before you run it on Windows. The
order matters there, and only there.

---

## What 5.0 is

A refactor release. Almost every change is internal: shared modules where six copies used
to live, an installer split into testable pieces, a Go daemon split by responsibility,
documentation whose counts match the code. No feature was removed from the product, and
nothing about how you use it changes.

Three things do need action, and one of them is the reason to upgrade.

---

## Step 1: close every editor session first

**This applies to Windows. On macOS and Linux, skip to [Step 2](#step-2-run-the-installer).**

5.0 stops console windows from appearing while the agent works — the flicker that pulled
you out of a game or a full-screen app every time a background hook or MCP call ran. The
fix routes each MCP server through `vkm-runhidden.exe`, and the installer has to **replace
that file on disk**.

Windows will not replace a running executable. If a Claude Code, Cursor or Codex session is
open, its MCP servers are holding `vkm-runhidden.exe` open, the replacement fails, and you
end up on a mixed install where some servers are launched the new way and some the old —
which still flashes, and looks like the fix did not work.

So, in this order:

1. **Quit every editor and agent session completely.** Not just the window — check the tray
   and Task Manager for stray `node.exe` under your editor.
2. Run the installer (Step 2).
3. Reopen your editor.

The installer detects a locked launcher and tells you, rather than reporting success over a
half-applied install. If you see that warning, close the session it names and re-run.

## Step 2: run the installer

Same command and same flags as before. Nothing about the CLI changed:

```bash
npx @vkmikc/create-vkm-kit@latest --full
```

If you installed a subset, keep your subset — the flags are unchanged
(`--obscura`, `--downloads`, `--doctor`, `--skills`, and the rest).

## Step 3: verify

```bash
npx @vkmikc/create-vkm-kit@latest --check-update
```

Then open a session and confirm two things:

- Your memory is still there. `vault_hybrid_search` for anything you know is in the vault.
- No console window appears while the agent runs a tool. On Windows this is the change you
  upgraded for; if a window still flashes, you almost certainly have a session that was open
  during Step 2 — go back to Step 1.

---

## What did NOT change

Deliberately, and permanently for 5.x. Every one of these lives in a file this kit does not
own, so renaming it would be a silent breakage no installer could repair
([ADR-0079](../adr/0079-naming-and-compatibility-tiers.md)):

| Kind                           | Stays exactly as it was                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| npm package and commands       | `@vkmikc/create-vkm-kit`, `create-vkm-kit`, `vkm`                        |
| MCP server ids in your config  | `basic-memory`, `obsidian-memory-hybrid`, `obscura-web`, `vkm-downloads` |
| Tool names in your `CLAUDE.md` | `mcp__obsidian-memory-hybrid__*`                                         |
| Environment                    | `BASIC_MEMORY_HOME`, every `OBSIDIAN_MEMORY_*` variable                  |
| Default vault path             | `~/Documents/obsidian-memory-vault`                                      |
| Python CLI subcommands         | all of them except `bench` (below)                                       |
| The daemon and its service     | `obsidian-memoryd`                                                       |

Your vault is plain Markdown in git and 5.0 does not touch its format. No re-index is
required. (`vault_fts_index({ semantic: true })` is still worth running after a large
import, exactly as before — that has not changed either.)

---

## Breaking changes

Four, and three of them can only reach you if you were driving the repo's own tooling
rather than using the kit.

### 1. `obsidian-memory-rag bench` was removed

Use `bench-recall` instead. It is the command CI already uses.

```bash
# before
obsidian-memory-rag bench --corpus <dir> --queries <file>

# now
obsidian-memory-rag bench-recall --corpus <dir> --queries <file> --assert-p95-ms 400
```

`bench` timed repeated searches with no ground truth, so it could report a fast engine that
returned the wrong notes. `bench-recall` reports p50/p95/mean per query **and** recall, and
can fail a build on either. Nothing invoked `bench`: not CI, not the MCP bridge, not a test.

### 2. The eval bench runners changed their stream contract

Only affects you if you script `evals/*/run.mjs`. Across all six benches, **stdout is now
JSONL rows and stderr is the human report**. Five of the six already did this;
`token-quality-ab` did the reverse and now matches. If you piped a bench to a file to keep
the summary, add `2>&1`:

```bash
node evals/token-quality-ab/run.mjs --mechanism compact-tool-output --models a,b 2>&1 | tee results.txt
```

`discipline-bench` also lists its conditions treatment-first now (`discipline`, then
`stock`), so its reported Δ has the same sign convention as every other bench. The
per-answer `condition` values are unchanged; only the order and the delta's sign flipped.

### 3. `docs/assets/bench-results-dark.svg` was deleted

The light and dark charts were byte-identical apart from seven hex values.
`bench-results.svg` is now theme-aware on its own. If you hotlinked the dark file, point at
`bench-results.svg`; if you used a `<picture>` element to switch them, a plain `<img>` now
does the right thing in both themes.

### 4. Changelog history moved

Entries for 3.15.0 and older are in
[`docs/changelog/pre-4.0.md`](../changelog/pre-4.0.md). They cover releases of
`@vkmikc/create-obsidian-memory`, an npm name deprecated and frozen since 4.0.0. Nothing
was edited — the sections and their link definitions moved verbatim.

Also moved: `docs/observability.md` is now `docs/en/observability.md`, so it sits with every
other English page and its Spanish mirror's language switcher points somewhere sane.

---

## If something looks wrong

- **A console window still flashes on Windows.** A session was open during the install. Close
  everything (including tray processes), re-run the installer, reopen. See Step 1.
- **An MCP server does not start.** Check that your `mcp.json` entry still names the same
  server id — 5.0 did not rename any of them, so an id that changed was changed locally.
- **Search returns nothing.** Confirm `BASIC_MEMORY_HOME` points at your vault. The default
  path is unchanged, so this only bites if you had set it somewhere custom and lost the
  setting.
- **Anything else.** `vkm-doctor` reports local usage and cache health, and
  [`docs/en/troubleshooting.md`](troubleshooting.md) covers the rest.

## See also

- [What's in 4.0](./migration-4.0.md) — if you are coming from 3.x, do that upgrade first.
- [ADR-0078](../adr/0078-allocate-and-hide-a-console.md) — why hiding a console beats denying
  one, and why the obvious fix makes the problem worse.
- [ADR-0079](../adr/0079-naming-and-compatibility-tiers.md) — which names may ever change.
