# ADR-0089: One protocol copy on Cursor + passage-first beats whole-note User Rules

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** maintainer

## Context

Measured on a real Cursor session in this repo (2026-08-21): the kit's `bench-tokens` k=3 wire
savings (62%) are real **against whole-note vault reads**. The same session still paid ~12 575
tokens/turn of always-on rules because:

1. `--full` wrote the full memory block to `AGENTS.md`, `~/.cursor/rules/obsidian-memory.mdc`,
   and the project `.cursor/rules/obsidian-memory.mdc` — Cursor loads all of them.
2. Docs told users to **also paste** that block into Cursor User Rules. User Rules outrank
   files, so a second protocol ("always `read_note` START_HERE + PROJECTS") dumped
   `PROJECTS/vkm-kit.md` (~19 428 tokens) **after** hybrid had already returned passages.
3. This repo's `00-stack.mdc` was `alwaysApply: true` while `AGENTS.md` AUTOGEN already
   contains the same stack text.

Cursor already has an `afterMCPExecution` JSON compact hook (`cursor-compact-mcp.mjs`). It does
not compact Bash, and it cannot undo a whole-note read the model chose to make.

## Decision

1. **One full protocol copy per Cursor project.** `AGENTS.md` (when `--rules` includes
   `agents`) holds the full block. Extra Cursor surfaces get `cursorPointerBlock` (~1/4 the
   size): "follow AGENTS.md; hybrid/assemble; never whole PROJECTS". `--rules cursor` alone
   still writes the full block on the project `.mdc` (or user-global when cwd is home).
   Reinstall replaces a legacy full `.mdc` in place (same sentinels).
2. **Passage-first outranks User Rules that dump vault notes.** Core arbitration: user
   preferences win on style/approach, **not** on "read START_HERE/PROJECTS/SESSION_LOG
   whole". Startup no longer opens `START_HERE.md` as a ritual.
3. **Do not paste the block into Cursor User Rules.** Install docs and the installer footer
   say so. Starter `START_HERE.md` templates match.
4. **This repo's `00-stack.mdc` is `alwaysApply: false`.** The stack text already lives in
   `AGENTS.md` AUTOGEN.

## Alternatives considered

- **Keep three full copies "for coverage".** Rejected — coverage was already 100% from
  `AGENTS.md`; the extras were pure tax and are what made the 62% claim feel false.
- **Invent a Cursor Bash token-saver.** Rejected — Cursor has no `afterBash` event
  (documented in `cursor-parity.md`). MCP JSON compact already ships.
- **`--rules-profile minimal` as the Cursor default.** Rejected as the only fix: it would
  drop the close ritual for everyone. The pointer keeps recall rules without a third
  treatise.

## Consequences

- Positive: a kit project in Cursor pays the protocol once (plus two cheap pointers), and
  agents are instructed not to dump 20k-token project notes even if an old User Rule says
  to. Reinstall is the migration.
- Negative: a Cursor workspace **without** `AGENTS.md` sees only the pointer on
  `~/.cursor/rules` after a `--full` install that also targeted `agents` on some other
  cwd. `--rules cursor` without `agents` still writes the full project `.mdc`.
- Neutral: Claude Code's AGENTS.md + CLAUDE.md double-pay (ADR-0063) is unchanged.

## References

- Audit 2026-08-21 in the vault `PROJECTS/vkm-kit.md` · ADR-0034 (wire savings, no
  whole-session claim) · ADR-0063 (fixed-layer inventory) ·
  `packages/create-vkm-kit/src/rules-merge.mjs` · `cursorPointerBlock` in `memory-rules.mjs`.
