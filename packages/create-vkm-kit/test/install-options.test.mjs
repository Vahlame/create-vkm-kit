/**
 * One options object, so a flag cannot reach one flow and miss the other.
 *
 * `--yes` and the wizard were two implementations of the same job. Grepping the
 * interactive path — the DEFAULT one — for `obscura|downloads|ollama|buildIndex|
 * installBackend` returned ZERO hits across 279 lines, so `npx create-vkm-kit --obscura`
 * wired no obscura, `--downloads`/`--ollama`/`--build-index`/`--install-backend` did
 * nothing at all, and only `-y` installed the full stack.
 *
 * `resolveOptions` is now the single decision and it is PURE, which is what makes it
 * testable here without spawning an installer or touching a filesystem.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveOptions } from "../src/cli/options.mjs";

const VAULT = "/tmp/vault";

/** Resolve as the CLI would, with the two rule resolvers stubbed to their identity. */
function opts(flags, { ides = ["claude"] } = {}) {
  return resolveOptions(["node", "cli", ...flags], {
    vault: VAULT,
    ides,
    lang: "es",
    dryRun: false,
    rulesTargets: () => ["agents"],
    rulesProfile: () => "full"
  });
}

test("the default stack is everything; --minimal opts back down", () => {
  const full = opts([]);
  for (const k of ["withHybrid", "semantic", "buildIndex", "installBackend", "vec"]) {
    assert.equal(full[k], true, `${k} should default on`);
  }
  const min = opts(["--minimal"]);
  for (const k of ["withHybrid", "semantic", "buildIndex", "installBackend", "vec"]) {
    assert.equal(min[k], false, `${k} should be off under --minimal`);
  }
});

test("an explicit opt-in forces a piece on even under --minimal", () => {
  assert.equal(opts(["--minimal", "--with-hybrid"]).withHybrid, true);
  assert.equal(opts(["--minimal", "--semantic"]).semantic, true);
});

test("a --no-<piece> always wins, even against its own opt-in", () => {
  assert.equal(opts(["--with-hybrid", "--no-hybrid"]).withHybrid, false);
  assert.equal(opts(["--build-index", "--no-build-index"]).buildIndex, false);
});

test("the flags the wizard used to ignore are resolved for BOTH flows", () => {
  // This is the regression. Each of these was unreachable without `-y`.
  assert.equal(opts(["--obscura"]).obscura, true);
  assert.equal(opts(["--downloads"]).downloads, true);
  assert.equal(opts(["--ollama"]).ollama, true);
  assert.equal(opts([]).buildIndex, true);
  assert.equal(opts([]).installBackend, true);
});

test("the heavyweight downloads stay opt-in, and --full does not grant disk writes", () => {
  // ~2.3GB and ~40MB respectively: a bare install must not surprise anyone.
  assert.equal(opts([]).ollama, false);
  assert.equal(opts([]).obscura, false);
  assert.equal(opts(["--full"]).ollama, true);
  assert.equal(opts(["--full"]).obscura, true);
  // vkm-downloads WRITES to the user's disk — a different risk surface from obscura's
  // web reads — so opting into web access must never silently grant it.
  assert.equal(opts(["--full"]).downloads, false, "--full must not imply --downloads");
  assert.equal(opts(["--downloads"]).downloads, true);
});

test("the reranker is opt-in and needs hybrid", () => {
  // It downloads a model on first use, so it is not part of the default stack.
  assert.equal(opts([]).rerank, false);
  assert.equal(opts(["--rerank"]).rerank, true);
  assert.equal(opts(["--rerank", "--no-hybrid"]).rerank, false, "no hybrid, no reranker");
});

test("Claude Code-only toggles stay off when Claude Code is not wired", () => {
  const cursorOnly = opts([], { ides: ["cursor"] });
  for (const k of [
    "nativeOverride",
    "enforce",
    "effortGate",
    "tokenSaver",
    "telemetry",
    "skills"
  ]) {
    assert.equal(cursorOnly[k], false, `${k} is Claude Code-only`);
  }
  const claude = opts([], { ides: ["claude"] });
  for (const k of [
    "nativeOverride",
    "enforce",
    "effortGate",
    "tokenSaver",
    "telemetry",
    "skills"
  ]) {
    assert.equal(claude[k], true, `${k} should ride along with Claude Code`);
  }
});

test("the enforcement hooks hang off the native-memory override", () => {
  const off = opts(["--no-native-memory-override"]);
  assert.equal(off.nativeOverride, false);
  assert.equal(off.enforce, false, "no override, nothing to enforce");
  assert.equal(off.effortGate, false);
  // ...but each also opts out on its own, keeping the override.
  const partial = opts(["--no-memory-enforcement"]);
  assert.equal(partial.nativeOverride, true);
  assert.equal(partial.enforce, false);
  assert.equal(partial.effortGate, true);
});

test("telemetry is independent of the token-saver", () => {
  // Coupling them meant --no-token-saver on a re-run silently stripped a telemetry sink
  // the user never asked to touch.
  const t = opts(["--no-token-saver"]);
  assert.equal(t.tokenSaver, false);
  assert.equal(t.terseStyle, false, "the style rides on the token-saver");
  assert.equal(t.telemetry, true, "but telemetry does not");
});

test("value flags are read, and RESEARCH/ defaults under the vault", () => {
  assert.equal(
    opts(["--searxng-url", "http://127.0.0.1:8888"]).searxngUrl,
    "http://127.0.0.1:8888"
  );
  assert.equal(opts(["--download-dir", "/dl"]).downloadDir, "/dl");
  assert.equal(opts([]).researchDir, `${VAULT}/RESEARCH`);
  assert.equal(opts(["--obscura-research-dir", "/r"]).researchDir, "/r");
});

test("resolveOptions is pure — same input, deeply equal output", () => {
  assert.deepEqual(opts(["--full", "--rerank"]), opts(["--full", "--rerank"]));
});
