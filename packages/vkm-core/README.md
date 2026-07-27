# @vkmikc/vkm-core

The shared layer under the kit's three MCP sidecars: result shaping, stdio plumbing, and the
prompt-injection scanner.

Part of [vkm-kit](../../README.md) — private, runs from the clone, never published.

## Why it exists

`obsidian-memory-mcp`, `obscura-web` and `vkm-downloads` are all stdio MCP servers, and they were
built by copy-paste from each other. That left three byte-identical copies of `mcp-result.mjs`,
three copies of the `pkgVersion` reader and the `main()` tail, and two forks of the
prompt-injection scanner.

The scanner is the reason this package is not just tidiness. The two forks drifted in **both**
directions, and the result was backwards: the copy guarding arbitrary fetched web pages had
strictly _less_ Spanish coverage than the copy guarding the user's own notes. It was missing
`haz caso omiso de …`, the exfiltration verbs (`filtra`/`envía`/`manda` + a secret object) and two
reveal verbs; the vault copy in turn was missing the web copy's broader
`(print|reveal|show|repeat) your (system )?(prompt|instructions)`. One of them even predicted the
drift in a comment — "when you strengthen one, consider the other" — which is not a mechanism.

## Modules

| Import                        | Exports                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `@vkmikc/vkm-core/mcp-result` | `toolHandler`, `asTextResult`, `asErrorResult`, `pkgVersionFrom`, `isEntryPoint` |
| `@vkmikc/vkm-core/untrusted`  | `scanInjection`, `normalizeForScan`, `escapeSource`, `envelope`                  |

Each consumer keeps what is genuinely its own. `untrusted.mjs` in the vault package says
**VAULT DATA**; `untrusted-web.mjs` in obscura-web says **WEB PAGE DATA fetched via obscura** and
flags search hits per result. That difference is real information for the model, so it stays where
it belongs; only the detection is shared.

## Scope

Zero runtime dependencies, no MCP/fs/network imports, everything unit-testable without spawning a
transport. A module belongs here only when **more than one** sidecar needs it and the behaviour
must not diverge. Feature logic stays in the feature package.

> The scanner is a **signal, not a control** — it can still be evaded by base64, cross-script
> homoglyphs NFKC does not fold, or novel phrasings. See [`SECURITY.md`](../../SECURITY.md).
