# Security Policy

## Why this file matters

`AGENTS.md`, `scripts/sync-agents.ts`, and the archived v1 prompt under `docs/legacy/` can drive an AI agent to run commands on a developer machine (install packages, write MCP config, install systemd/LaunchAgent services, push git remotes). A malicious change is effectively an RCE/social-engineering vector against anyone who follows the instructions verbatim.

Treat issues with agent-facing instructions the same way you would treat issues with a system installer.

## Supported versions

| Version | Supported                                                          |
| ------- | ------------------------------------------------------------------ |
| 3.x     | yes                                                                |
| 2.x     | superseded docs model (pre–v3 kit scripts); upgrade to v3 guidance |
| 1.x     | best-effort (legacy prompt only)                                   |
| < 1.0   | no                                                                 |

Only the latest minor of the current major receives fixes. We will not backport.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Email the maintainer privately, or use GitHub's "Report a vulnerability" form under the `Security` tab. Include:

- a description of the issue,
- the file / section of `AGENTS.md` or `docs/legacy/PROMPT_ULTRA_COMPLETO_v1.md` involved (or which generated script),
- a proof of concept, or a clear description of the attack scenario,
- the impact (data exfiltration, code execution, privilege escalation, denial of memory, etc.).

You will get an acknowledgement within 72 hours. Expected timeline from report to public fix:

- triage: 3 business days,
- fix or mitigation released: 14 days for critical / high, 30 days for medium / low,
- public disclosure: coordinated, after a fix is available.

## What we consider in scope

- Any path that downloads or executes arbitrary code from a non-pinned source (`mcp-remote` must stay **>= 0.1.16**; see `docs/security/mcp-remote-rce.md`).
- The Go daemon (`obsidian-memoryd`) if it can be tricked into writing outside the vault, leaking secrets, or escalating privileges.
- Optional telemetry (`packages/obsidian-memory-mcp`) if it exfiltrates PII without redaction controls.

## Out of scope

- Bugs in `basic-memory`, `cyanheads/obsidian-mcp-server`, or third-party MCP servers. Report those upstream.
- Bugs in Cursor or MCP protocol. Report those to the respective vendors.
- General Windows privilege issues unrelated to the prompt.
- Reports requiring physical access to the user's machine.

## Hardening guidance for users

If you are about to follow agent instructions from this repo:

1. Verify the commit hash against a known good release tag.
2. Ensure remote URLs point to repositories you control.
3. Inspect generated scripts under your vault before enabling daemons or scheduled tasks.
4. Keep 2FA enabled on GitHub.
5. Never paste secrets into chat; the vault is for memory, not credentials.

## Past advisories

None yet.
