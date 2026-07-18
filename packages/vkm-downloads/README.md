# `@vkmikc/vkm-downloads`

A guarded **file-download manager** for your AI agent — an **opt-in** MCP server that lets the agent
download files from the web to `~/Downloads/vkm-kit/`, with the guardrails that make that safe.

Part of [vkm-kit](../../README.md). Runs from the clone (a private workspace package), wired for
Claude Code, Codex and Cursor by the installer under `--downloads`. See
[ADR-0058](../../docs/adr/0058-vkm-downloads-file-download-tool.md).

## Why a separate package (not part of obscura-web)

`obscura-web` (ADR-0051) reads the web as untrusted DATA. This tool **writes bytes to your disk** —
a different, higher risk surface. So it is a **separate package with its own installer flag**
(`--downloads`), deliberately **not** bundled into `--full`: opting into stealth web reads must
never silently grant disk-write capability. You turn this on, specifically, on purpose.

## Workflow (how the agent should use it)

1. The user asks for a file. The agent finds a URL (via `obscura_search` / native `WebSearch`).
2. The agent calls **`download_resolve`** — metadata only, **writes nothing** — and shows the user
   the source URL, filename, and size.
3. Only after the user's **explicit go-ahead** does the agent call **`download_file`**.

This reinforces (it does not replace) Claude Code's own rule that downloading a file is a
per-action decision the user makes. The downloaded file is **never opened or executed**.

## Tools

### `download_resolve(url)`

Fetch metadata for a URL — `filename`, `content_type`, `size_bytes`, `final_url` (after redirects)
— **without writing anything to disk**. HEAD first, falling back to a GET whose body is discarded
the moment headers arrive. Safe to call before asking the user.

| Param | Type   | Notes                    |
| ----- | ------ | ------------------------ |
| `url` | string | Absolute **http(s)** URL |

Returns `{ final_url, filename, content_type, size_bytes, _trust, _note }`. The `filename` /
`content_type` come from the URL and the server's headers — **untrusted web data**, sanitized.

### `download_file(url, filename?)`

Stream a file from a public **http(s)** URL to `~/Downloads/vkm-kit/` and return `{ path, filename,
size_bytes, sha256, content_type, final_url }`. **Side-effecting** — it writes a file to disk.

| Param       | Type   | Notes                                                                                                                                    |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `url`       | string | Absolute **http(s)** URL to download                                                                                                     |
| `filename`  | string | Optional name to save as (sanitized; path components / unsafe chars stripped). Defaults to the name derived from the URL / content type. |
| `max_bytes` | int    | Override the size cap for this download (default `VKM_DOWNLOAD_MAX_BYTES`, 500MB). For a truly large/slow file use `download_start`.     |

`download_file` is the **synchronous** path — for a file that finishes within the MCP transport's
~60s wall. For large or slow downloads, and for **sets** of files, use `download_start`.

### `download_start({ files, max_bytes?, prefer_fastest? })`

Download one or **many** files in the **background** and return a `job_id` immediately, beating the
~60s wall (a synchronous call would be truncated). Each file may list several **mirror URLs**; with
`prefer_fastest` (default) the fastest is measured and used. Files stream to `~/Downloads/vkm-kit/`,
**resume** via HTTP Range if interrupted, are size-capped + **free-disk-space-checked**, and are
never opened or executed. **Side-effecting** — confirm sources/sizes with the user first, exactly
as for `download_file`.

| Param            | Type    | Notes                                                                                          |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `files`          | array   | `[{ urls: string[], filename? }]` — each entry is one output file with one or more mirror URLs |
| `max_bytes`      | int     | Per-file cap (default: a high ceiling; the real guard for big files is free disk space)        |
| `prefer_fastest` | boolean | Probe each file's mirrors and download from the fastest (default `true`)                       |

Returns the initial job snapshot `{ job_id, state, files: [...] }`. Poll `download_status(job_id)`.

### `download_status(job_id?)` · `download_cancel(job_id)`

`download_status` reports per-file `state` (queued/probing/downloading/done/failed/cancelled),
`bytes`, `total`, `speed_bps`, and — when done — `path` + `sha256`; omit `job_id` to list all jobs
(read-only). `download_cancel` aborts a running job's in-flight transfers and removes their `.part`
files.

### `probe_mirrors(urls, probe_bytes?)`

Given several candidate URLs for the **same file** (mirrors you found via search), rank them
**fastest-first** by measured throughput (and latency), so a download runs from the fastest source.
Reads only ~512 KB per mirror even for a multi-GB file. Returns `{ ranked, fastest }`; a
`size_mismatch` flag marks a candidate whose size disagrees with the majority (it may not be the
same file). Read-only. `download_start(prefer_fastest)` does this for you.

## Guardrails

- **http(s) only.** A `file:`/`data:`/`ftp:`/… URL is rejected before any network call.
- **No private/loopback targets.** The host is resolved once and **refused** if any record is
  loopback/private/link-local/CGNAT (IPv4, IPv6, IPv4-mapped). This is a confused-deputy guard:
  a URL that arrived from an untrusted search result must not be able to make the tool GET a local
  service (Ollama `:11434`, SearXNG, a local HTTP MCP). The socket is **pinned** to the validated
  address, so there is no resolve-then-connect DNS-rebinding gap. Redirects are followed (max 5)
  and **re-validated on every hop** — a 302 to `http://127.0.0.1` is refused.
- **Size cap.** `VKM_DOWNLOAD_MAX_BYTES` (default 500MB), checked by `Content-Length` and,
  authoritatively, **mid-stream** — an oversize download is aborted and its **partial file
  deleted**.
- **Sanitized, root-checked filename.** `../`, path separators, `%2f`, NUL/control bytes,
  Windows-illegal characters and reserved device names (`CON`, `NUL`, `COM1`…) are stripped; the
  destination is `path.resolve`-checked to be **inside** the root before writing; an existing file
  is **never overwritten** (a `(1)`/`(2)`-style numeric suffix is added).
- **Never executed.** The file is saved as-is and never opened or run — this server has no such
  capability, and no code path spawns a process.
- **Audit log.** Every completed download is appended to `~/.vkm/downloads/downloads.log` (one JSON
  object per line), so you can see after the fact what was fetched and where it landed.

## Install

```bash
npx @vkmikc/create-vkm-kit --downloads        # wire vkm-downloads (needs a kit clone)
```

`--downloads` is its own flag — **not** part of `--full`. There is no binary to download (pure
Node stdlib); the installer only wires the MCP server, which needs a kit clone for the bridge path.

## Environment

| Var                         | Purpose                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `VKM_DOWNLOAD_DIR`          | Download root (default `~/Downloads/vkm-kit`)                                                    |
| `VKM_DOWNLOAD_MAX_BYTES`    | **Synchronous** (`download_file`) size cap in bytes (default `524288000`, 500MB)                 |
| `VKM_DOWNLOAD_MAX_BYTES_BG` | **Background** (`download_start`) per-file ceiling (default 100GB; disk space is the real guard) |
| `VKM_DOWNLOAD_LOG`          | Audit-log path (default `~/.vkm/downloads/downloads.log`)                                        |

## Large files, slow links, and the 60s wall

The MCP transport times out a single tool call at ~60s and this server cannot extend that — so a
large or slow download can't be a synchronous `download_file`. `download_start` runs the transfer in
the **background** (an async task in this long-lived stdio server — no child process), returning a
`job_id` at once; you poll `download_status`. A multi-GB ISO over a slow link just takes as long as
it takes. If a download is interrupted (a `download_cancel`, a network drop, or a Claude Code
restart that ends the server), its `.part` file lets a re-issued `download_start` **resume** from
where it stopped via HTTP Range rather than starting over. Background jobs live in the server
process only: a restart ends in-flight jobs (their `.part` files remain, resumable).

## Security

- **http(s) only, private/loopback refused, IP-pinned** — see Guardrails above. The threat model is
  a confused-deputy against local services, not classic SSRF (the server already runs on your
  machine); the guard is the reason an injected URL can't be turned against the kit's own loopback
  ports.
- **No shell.** The download uses `node:http`/`node:https` with an argv-free API; only http(s) URLs
  are accepted, so a crafted "url" can't become a flag or reach a shell.
- **Untrusted by construction.** A resolved filename / content type is web-derived data, sanitized
  and never treated as an instruction.
- **Never executes downloads.** Downloading-and-executing from an untrusted source is prohibited and
  has no supported path here.

## Testing

```bash
npm test -w @vkmikc/vkm-downloads
```

Covers the address guard (IPv4/IPv6/mapped/rebinding/fail-closed), the scheme gate, filename
sanitization + root-check + de-dup, and the full download core over an injected fake
request/response + fake DNS (no sockets, no real DNS): scheme rejection never touches the network,
a private-resolving host is refused before any request, redirects are followed and re-validated (a
redirect to a private IP is refused), the byte cap trips on `Content-Length` and mid-stream (with
the partial file deleted), a clean download lands inside the root with the correct bytes/size/hash,
and the MCP handlers over an in-memory transport (resolve writes nothing; file forwards + logs +
returns; a guard error surfaces as `isError`).

## License

vkm-kit is MIT + attribution ([`LICENSE.md`](LICENSE.md)).
