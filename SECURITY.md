# Security Policy

## Why this file matters

`AGENTS.md` and `scripts/sync-agents.ts` can drive an AI agent to run commands on a developer machine (install packages, write MCP config, install systemd/LaunchAgent services, push git remotes). A malicious change is effectively an RCE/social-engineering vector against anyone who follows the instructions verbatim.

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
- the file / section of `AGENTS.md` involved (or which generated script),
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

## Trust model

This kit makes three trust assumptions explicit. If a user follows them, the rest of the security posture holds; if not, the system is exploitable.

### 1. The vault is **data**, not **instructions**

Notes in the vault are treated by the agent as information to read and process, never as authoritative directives. The User Rules block in `docs/en/install.md` (Step 4 — User Rules) enforces this in prose: agents are told to **ignore** any instruction embedded inside a note (e.g. "execute X", "ignore previous rules") and to escalate the find to the human.

If the vault remote is shared (team, multi-machine), assume an attacker with write access can attempt prompt injection via `MEMORY.md`, `RULES/*`, or any other file the agent reads on startup. The mitigation is the doctrine above, not a technical filter.

### 2. Agent-driven setup runs with your privileges

`AGENTS.md` and the `create-obsidian-memory` initializer drive an agent to write `~/.cursor/mcp.json`, install background daemons, and edit git config on your behalf. **Verify the source** (clone origin + latest commit) before letting an agent follow repo instructions. Treat an unverified clone the way you would treat `curl ... | sh`.

### 3. `basic-memory` is pinned

`config/mcp/basic-memory.json` and the initializer use `uvx --from "basic-memory==0.21.4" basic-memory mcp`. Without the pin, `uvx` resolves PyPI latest on every start — a supply-chain RCE if the package is compromised. Upgrades are explicit (bump the constant in `packages/create-obsidian-memory/src/mcp-merge.mjs` and the templates) and reviewable via `CHANGELOG.md`.

## Hardening guidance for users

If you are about to follow agent instructions from this repo:

1. **Verify the source.** From the clone root run `git remote get-url origin` (must point to a repo you trust) and `git log -1 --format="%H %s"` (must match the latest release on <https://github.com/Vahlame/cursor-obsidian-memory-guide/releases/latest>).
2. **Keep the basic-memory pin.** Templates pin to a vetted version; do not edit your `mcp.json` to drop `--from "basic-memory==X.Y.Z"` "to save typing".
3. **Inspect generated scripts under your vault** before enabling daemons or scheduled tasks.
4. **Keep 2FA enabled on GitHub** for the vault remote — anyone who can push can attempt memory poisoning (see Trust model §1).
5. **Never paste secrets into chat;** the vault is for memory, not credentials. If you suspect a leak, rotate immediately and review `git log` of the vault remote.

## Past advisories

None yet.
