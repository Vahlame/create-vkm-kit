# ADR-0016: Default localhost port for Streamable HTTP `basic-memory`

## Status

Accepted

## Context

`basic-memory` can run as a long-lived **Streamable HTTP** listener so Cursor connects via `"url": "http://127.0.0.1:<port>/mcp"`. Early docs used **port 8000** as a mnemonic (“HTTP-ish round number”). On developer machines, **8000**, **8080**, and **3000** are frequently bound by unrelated apps (framework defaults, other MCPs, accounting or admin tools). When another process owns the port, an idempotent “something is listening” check can **skip starting** `basic-memory`, while Cursor still gets **`fetch failed`** because the listener is not the MCP server.

## Decision

- Canonical default for this kit: **`127.0.0.1:8765`** for Streamable HTTP `basic-memory` (template `config/mcp/basic-memory-streamable-http.json` and Windows setup docs).
- **Rule for future apps:** pick a **high, project-specific** localhost port (e.g. **8765–8899**), verify it is free (`netstat` / `Get-NetTCPConnection`), and keep **script `-Port`**, **`mcp.json` `url`**, and any **firewall / compose** definitions identical.
- **8000 remains a valid user override**; we only change the **documented default** to reduce surprise collisions.

## Consequences

- Existing users on **8000** must align `mcp.json` + script once when they pull new docs/templates, or stay on 8000 if they control that port.
- Troubleshooting and setup guides reference **8765** first; conflict guidance points to choosing another free port with the same sync rule.

## Related

- `docs/setup/windows-basic-memory-always-on.md`
- `docs/troubleshooting.md` (`fetch failed`, port conflicts)
