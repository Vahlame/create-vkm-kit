# ADR-0059: vkm-downloads — background jobs, sets, resume, and fastest-mirror selection

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** maintainer
- **Extends:** [ADR-0058](0058-vkm-downloads-file-download-tool.md)

## Context

ADR-0058 shipped a **synchronous** `download_file`. The user then required that the tool "download
large files or SETS of files, whether the download is fast or slow" and "find the site with the
fastest download." Two hard walls block the synchronous tool:

1. **The MCP transport times out a tool call at ~60s** (the same wall obscura-web hit in ADR-0057),
   and this server cannot extend it. A 3 GB ISO — verified live: Hiren's BootCD PE x64 is
   3,291,686,912 bytes — over any real link exceeds 60s, so it can't be one synchronous call.
2. **The conservative 500MB cap** (correct for a synchronous, event-loop-occupying transfer) refuses
   exactly the large files the user now wants.

And "fastest download" needs a way to compare candidate mirrors by _measured_ speed, not by
guessing from the URL.

## Decision

Additive to ADR-0058 — the sync `download_file` and all its guardrails are unchanged. Four new tools
plus a background job runner, all reusing ADR-0058's guarded request path.

1. **Background jobs beat the 60s wall.** `download_start` registers a job and returns a `job_id`
   **immediately**; the transfer runs as a floating async task **inside this long-lived stdio
   server** — deliberately **not** a child process, so ADR-0058's "no code path spawns a process"
   security property (the reason downloaded bytes can never be executed) still holds. Because
   streaming is async I/O it doesn't block the event loop, so `download_status` / `download_cancel`
   are served while a transfer is in flight. Jobs live in the process only: a Claude Code restart
   ends in-flight jobs (documented), and their `.part` files make them resumable.
2. **Sets + mirrors in one shape.** `download_start({ files: [{ urls, filename? }] })` — each entry
   is one output file with one or more **mirror** URLs. A set is many entries (bounded-concurrent);
   a mirrored file is one entry with several URLs.
3. **Fastest mirror by measurement, not guess** (`probe_mirrors`, and `prefer_fastest` inside
   `download_start`). Each candidate gets a small **ranged GET** (default 512 KB): we time the
   connection latency and the throughput of that slice, then abort — so probing a 3 GB mirror costs
   ~512 KB even if the server ignores `Range`. Mirrors rank by throughput (latency tiebreak); a
   `size_mismatch` flag marks a candidate whose size disagrees with the majority (likely not the
   same file). Every probe goes through the **same guarded `openStream`** as a real download, so a
   private/loopback "mirror" is refused, not probed. The agent finds candidate mirrors (search); the
   tool measures them — the division that keeps search out of this package.
4. **Large files are gated by free disk space, not a hard byte wall.** Background transfers default
   to a high ceiling (`VKM_DOWNLOAD_MAX_BYTES_BG`, 100GB) and add an `fs.statfs` **free-space check**
   before writing (refuse if the file wouldn't fit with a margin) — a better guard for "large" than
   an arbitrary byte cap, while the mid-stream byte cap remains the backstop against a lying server.
5. **Resume via HTTP Range.** Downloads stream to `<name>.part`; if a `.part` from an interrupted
   attempt exists, the next run sends `Range: bytes=<partSize>-` and appends (falling back to a
   clean restart if the server answers `200`, i.e. ignores Range; treating `416` as "already
   complete"). The `.part` name is derived from the URL/suggestion only (never the content-type), so
   it is stable across attempts; the final name (which may gain a content-type extension) is applied
   only at the rename, still root-checked and no-overwrite de-duped. A resumed transfer's running
   hash is incomplete, so its SHA-256 is recomputed from the finished file.

## Alternatives considered

- **A detached child-process downloader that survives Claude Code restarts:** rejected — it breaks
  the package's "never spawn a process" property (the guarantee that downloaded content is never
  executed) for a robustness gain that `.part`+Range resume already delivers on the next call.
- **Just raise the sync cap and let `download_file` handle big files:** rejected — no cap raise can
  beat the 60s transport wall; a slow multi-GB transfer must be asynchronous.
- **Pick the mirror by HEAD latency alone (no throughput probe):** rejected — latency doesn't
  predict bandwidth, and for a large file bandwidth dominates; a 512 KB ranged sample measures the
  thing that actually matters at ~512 KB of cost.
- **A hard byte cap for background too:** rejected — the user's requirement is large files; free
  disk space is the honest limit, with the byte cap kept only as a runaway backstop.
- **Reformat/normalize the probe by downloading a fixed time slice instead of a fixed byte slice:**
  rejected — a byte slice bounds cost deterministically (a fixed time slice on a fast mirror could
  pull tens of MB); throughput = bytes/time is computed from the byte slice either way.

## Consequences

- Positive: large files and sets download regardless of speed (verified live — the real 3 GB Hiren's
  ISO the sync path refused streamed in the background at ~130 Mbps and was cancellable, and
  `probe_mirrors` ranked its real mirrors by measured throughput); resume survives interruptions;
  the fastest source is chosen by measurement. All guardrails (http(s)-only, IP-pinned private-range
  refusal, root-check, never-execute) carry over unchanged, plus a disk-space guard.
- Negative: background jobs are in-process, so a Claude Code restart ends in-flight transfers (their
  `.part` files remain, resumable) — a documented limitation, the accepted cost of not spawning a
  process; progress/speed and job state live in memory (mirrored best-effort to a state file), not a
  durable queue.
- Neutral: additive — `download_file` and ADR-0058's contract are byte-for-byte unchanged; no new
  installer flag (the `--downloads` server just exposes more tools; they appear on restart).

## References

- `packages/vkm-downloads/src/` (`jobs.mjs`, `mirror.mjs`, `download.mjs` `openStream`/
  `assertDiskSpace`/`envMaxBytesBackground`, `filename.mjs` `safeJoin`, `downloads-mcp.mjs`),
  `packages/vkm-downloads/test/` (`jobs.test.mjs`, `mirror.test.mjs`).
- ADR-0058 (the synchronous tool + guardrails this extends), ADR-0057 (the same 60s MCP wall,
  handled there with a deadline+partial rather than backgrounding).
