# ADR-0048: vkm-spec GUI transport (SSE) and the suite's port allocation

- **Status:** Accepted
- **Date:** 2026-07-10
- **Deciders:** maintainer

## Context

The vkm-spec GUI (inherited shell pattern from the prompt-compiler: `node:http` + a static vanilla-JS page, no framework, no build step — ADR-0046) needs to stream an Ollama draft to the browser as it generates: at ~7-12 tok/s on CPU (ADR-0047) a draft takes tens of seconds, and a spinner that long reads as a hang. Separately, the suite now runs several localhost listeners and the donor GUI's port choice was actively bad: it sat on **4317**, which is the OpenTelemetry OTLP/gRPC default — exactly the neighborhood ADR-0044 moved the kit into.

## Decision

1. **Server-Sent Events for the draft stream.** `POST /api/draft` responds as an SSE stream: `progress` frames (token counts) while Ollama generates, then `done` with `{spec, xml, source}` — or `error`, which **still carries a working deterministic spec+xml** with `source: "fallback"` (the CI-pinned degradation invariant, ADR-0047). SSE costs ~30 lines over `node:http`, needs no dependency, no client library, and no server-side job state — the response _is_ the job. The frame format has one source of truth (`formatSseEvent`/`parseSseFrames`), pinned by tests.
2. **Port allocation.** The GUI's `DEFAULT_PORT` is **4923** (override `VKM_SPEC_PORT`), deliberately vacating 4317. The suite's localhost map is now: **4319** OTLP sink (ADR-0044, itself off the 4317/4318 OTLP defaults to avoid a user's real collector), **4923** spec GUI, **11434** Ollama (its own default), 8765 basic-memory (ADR-0016) — no member sits on another tool's well-known port.
3. **Bind 127.0.0.1 only** — the GUI serves private vault content and is never reachable from the network.
4. **`EADDRINUSE` handled, not fatal:** the port already being taken means a previous instance is running (the double-clicked desktop shortcut case) — the launcher reopens the browser tab on the existing instance instead of erroring.

## Alternatives considered

- **WebSockets:** rejected — bidirectional transport for a strictly one-way stream; requires either a dependency or hand-rolling the upgrade/framing protocol; SSE is native `EventSource` in every browser.
- **Polling a job endpoint:** rejected — needs server-side job state (creation, lookup, expiry), adds poll latency to a stream whose whole point is liveness, and is more code than SSE, not less.
- **Keeping port 4317:** rejected — colliding with the OTLP/gRPC default in the same suite that ships an OTLP pipeline (ADR-0044) guarantees eventual mysterious failures; ports are cheap, debugging port theft is not.
- **A single multiplexed "vkm port" for sink + GUI:** rejected — the processes have different lifetimes (sink is a session-long singleton, GUI is on-demand) and coupling them buys one fewer port at the cost of a shared process supervisor.

## Consequences

- Positive: the draft streams live with zero added dependencies and zero server-side state; every suite listener has a collision-free, individually overridable port; a killed Ollama mid-draft still yields a usable spec in the same response.
- Negative: SSE is one-way — any future interactive drafting (mid-stream steering) would need a transport change; non-default ports must be documented since nothing about 4319/4923 is guessable.
- Neutral: proxies/buffering middleboxes that break SSE are irrelevant on loopback; the static-page, no-framework GUI stance is inherited unchanged from the donor (ADR-0046).

## References

- `packages/vkm-spec/src/server.mjs` (`DEFAULT_PORT` 4923 with the 4317-collision comment, SSE frame helpers, loopback bind, port-taken handling).
- ADR-0016 (first port-collision lesson, basic-memory on 8765), ADR-0044 (sink on 4319), ADR-0046 (GUI shell provenance), ADR-0047 (the stream being transported + fallback invariant).
