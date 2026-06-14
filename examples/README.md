# Examples

A walkthrough of what a healthy vault looks like a few weeks into use. All names and projects are fictional.

Use these as a template for your own first entries.

| File                                                   | What it shows                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`START_HERE.md`](./START_HERE.md)                     | Entry point, reading order, and v3 health pointers (no kit-shipped Windows scripts).                   |
| [`MEMORY.md`](./MEMORY.md)                             | Global preferences, durable rules, language and style choices. Stable across projects.                 |
| [`SESSION_LOG.md`](./SESSION_LOG.md)                   | Chronological bullet log. Newest at the bottom. One line per real decision.                            |
| [`TAGS.md`](./TAGS.md)                                 | Living index of `type:` / `tags:` conventions.                                                         |
| [`KNOWN_FAILURES.md`](./KNOWN_FAILURES.md)             | Discarded approaches with reasons (prevents repeated mistakes).                                        |
| [`PROJECTS/example-app.md`](./PROJECTS/example-app.md) | A per-project file with context, decisions, useful commands, and TODOs.                                |
| [`PROJECTS/TEMPLATE.md`](./PROJECTS/TEMPLATE.md)       | The empty starting point for a new project. Same shape the agent scaffolds.                            |
| [`RULES/.gitkeep`](./RULES/.gitkeep)                   | Placeholder so Git tracks an empty `RULES/` directory until the first `RULES/<project>.md` exists.     |
| [`.gitignore`](./.gitignore)                           | What a private vault should never commit (secrets, reviews, logs, noisy Obsidian files).               |
| `.vscode/settings.json` _(generated)_                  | The initializer writes this into your vault root: fewer Git-polling and `conhost` flashes on Windows.  |
| **FTS index (optional)**                               | If you use `obsidian-memory-hybrid`, ignore `.obsidian-memory-rag/` via `.gitignore` (already listed). |

## Style cues to copy

- One bullet per fact. Never bury two ideas in the same line.
- Dates are `YYYY-MM-DD`.
- Decisions are framed as `<choice> -> <reason>`.
- Hypotheses are explicitly marked (`hypothesis:`).
- No secrets, no tokens, no full URLs to private repos.

## What NOT to do

The corresponding anti-patterns:

- pasting a stack trace into `SESSION_LOG.md` (it's a log of decisions, not of errors),
- dumping a 4-paragraph "what I did today" entry (split it into bullets, or it becomes unreadable),
- writing `// TODO: refactor this` (this isn't code; write `TODO refactor X because Y`),
- copy-pasting an entire `.env` even if it looks safe (a future-you will eventually push secrets up).
