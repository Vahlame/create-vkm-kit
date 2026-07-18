# ADR-0058: vkm-downloads — a guarded file-download manager MCP

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** maintainer

## Context

The user wanted Claude, when the kit is installed, to act as a download manager: the user asks for
something, Claude finds a URL (search) and downloads the file to the machine. No existing tool
writes files to disk — `obscura-web` (ADR-0051) only fetches/renders pages as read-only DATA.

This is a genuinely different risk surface from web reads, and it collides head-on with the
hard rules in Claude Code's own system prompt: _"Downloading any file requires explicit
permission (state filename, source, and size when asking)"_ and _"Downloading or executing files
from untrusted sources"_ is prohibited. So the design is as much about the **confirmation flow and
the guardrails** as about the mechanism. Constraints carried in from the approved `/vkm-spec`:

- A **separate package and installer flag** (`--downloads`), so opting into stealth web reads
  (`--obscura`/`--full`) never silently grants disk-write capability — consent granularity.
- Land files in a **single fixed, easy-to-shield root**: `~/Downloads/vkm-kit/`.
- Refuse anything that could turn the tool into a **confused-deputy against the kit's own local
  services** (Ollama `:11434`, on-demand SearXNG, a local HTTP MCP) — a URL that arrived from an
  untrusted search result must not be able to make this tool GET `http://127.0.0.1:11434/...`.
- **Never** open or execute what was downloaded.

## Decision

1. **New self-contained package `packages/vkm-downloads/`** — a stdio MCP server exposing two
   tools, registered for Claude Code / Codex (CLI) and Cursor (`mcp.json`) via the existing
   `mcp-merge.mjs` factory seam, gated to its own `--downloads` flag. Carries its own small
   `toolHandler` copy (ADR-0051 decision #6's decoupling convention); its only runtime deps are
   `@modelcontextprotocol/sdk` + `zod`, already in the ecosystem.
   - `download_resolve(url)` — metadata only (HEAD, falling back to a GET whose body is destroyed
     the moment headers arrive). Writes nothing; safe to call before asking the user.
   - `download_file(url, filename?)` — streams the file to `~/Downloads/vkm-kit/` and returns the
     saved path, size, and SHA-256.
2. **`node:http`/`node:https` with a pinned, pre-validated IP — not global `fetch`.** The private-
   range guard must hold at CONNECT time, not just check time. `resolveAndValidate` resolves the
   host **once**, refuses if **any** returned record is loopback/private/link-local/CGNAT (IPv4,
   IPv6, and IPv4-mapped), and the socket is pinned to that exact address via a fixed `lookup`.
   `fetch` re-resolves internally, which would leave a DNS-rebinding TOCTOU in precisely the guard
   that makes this safe; the stdlib client lets us close it while staying dependency-free. Redirects
   are followed manually (max 5) and **re-validated on every hop**, so a 302 to `http://127.0.0.1`
   is refused. http(s) only; a crafted `file:`/`data:`/`ftp:` URL is rejected before any network.
3. **Byte cap enforced twice** (`VKM_DOWNLOAD_MAX_BYTES`, default 500MB): by declared
   `Content-Length` before streaming, and — authoritatively, against a lying or omitted length —
   by counting bytes mid-stream through a `Transform`, which aborts and **deletes the partial
   file**. SHA-256 is computed while streaming.
4. **Filename is untrusted and root-checked.** The suggested name (from the agent, ultimately from
   the web) and the URL basename are sanitized (strip `../`, path separators, `%2f`, NUL/control
   bytes, Windows-illegal chars, reserved device names); the extension comes from the URL/name or
   the Content-Type, **never** from an unvalidated `Content-Disposition`. `resolveWithinRoot` runs
   `path.resolve` + a prefix check **before** writing and refuses anything escaping the root, and
   **never overwrites** — it appends ` (1)`, ` (2)` like a browser (data-loss guard).
5. **Never executes or opens the file**, and no code path in the package spawns a process
   (`child_process`/`execa`/shell) — verifiable by grep, and a permanent property, not a current
   omission.
6. **Confirmation is layered, not replaced.** The tool descriptions + server instructions tell the
   agent to `download_resolve` first, show the user the source/filename/size, and only call
   `download_file` after the user's explicit go-ahead — reinforcing (never substituting for) Claude
   Code's own per-action download-permission rule. Every completed download is appended to a JSONL
   audit log (`~/.vkm/downloads/downloads.log`), mirroring obscura-web's `search-log.mjs`.
7. **`--downloads` is deliberately NOT part of `--full`** — even though `--full` includes
   `--obscura` — so the disk-write capability is only ever wired by an explicit, separate opt-in.

## Alternatives considered

- **Extend obscura-web with the download tools** (one package, `--obscura` flag): rejected — it
  would change what `--obscura`/`--full` already mean for existing users, silently upgrading a
  read-only web capability into disk-write. A separate package/flag keeps consent granular.
- **Use global `fetch` + `pipeline(Readable.fromWeb(...))`** (as first sketched in the spec):
  rejected for the guard — `fetch` re-resolves DNS and offers no supported way to pin the socket to
  a vetted IP without adding `undici` as a dependency, leaving a DNS-rebinding TOCTOU in the
  private-range check. `node:http(s)` with a custom `lookup` is stdlib and closes it.
- **Trust `Content-Disposition` for the filename:** rejected — attacker-controlled response header;
  the URL basename / Content-Type are sufficient and far lower-risk.
- **Fold `--downloads` into `--full`:** rejected — writing bytes to the user's disk must not ride
  along with a web-read opt-in (see decision #7).
- **A "run after download" convenience:** rejected outright — downloading-and-executing from an
  untrusted source is prohibited by the harness rules and has no safe version here.
- **Block only literal private-IP URLs (no DNS resolution):** rejected — a hostname with a private
  A record (or a redirect to one) would slip through; resolving + validating + pinning is the floor.

## Consequences

- Positive: Claude can fulfil "download X" end-to-end, safely — public http(s) only, private/
  loopback refused (rebinding-safe), size-capped, sanitized + root-checked filenames, never
  executed, audit-logged; zero cost and zero new capability for users who don't pass `--downloads`.
- Negative: a very large download can exceed the MCP transport's ~60s wall (the file still lands on
  disk, but the tool result may be lost) — documented in the README as a known limitation; a
  class-based/ambient DNS edge (a resolver returning a fresh private answer on a second, unrelated
  lookup) is out of scope because the connection is pinned to the first validated address.
- Neutral: opt-in (`--downloads`); pure stdlib (no third-party binary to pin/hash, unlike
  obscura); version-locked to the kit (ADR-0042/0051).

## References

- `packages/vkm-downloads/src/` (`downloads-mcp.mjs`, `download.mjs`, `safe-url.mjs`,
  `filename.mjs`, `download-log.mjs`, `mcp-result.mjs`), `packages/vkm-downloads/README.md`,
  `packages/create-vkm-kit/src/mcp-merge.mjs`
  (`downloadsServer`/`mergeDownloadsServer`/`downloadsMcpPathsFromKitRoot`),
  `packages/create-vkm-kit/src/index.js` (`--downloads` wiring), `scripts/version.mjs` (marker).
- ADR-0051 (obscura-web: the self-contained-package + untrusted-DATA + best-effort-install pattern
  mirrored here), ADR-0056 (root-checked writes under a fixed root), ADR-0042 (suite version-lock).
