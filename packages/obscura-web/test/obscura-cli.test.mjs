import test from "node:test";
import assert from "node:assert/strict";
import { isHttpUrl, obscuraFetch, obscuraAvailable } from "../src/obscura-cli.mjs";

test("isHttpUrl accepts only absolute http(s) URLs", () => {
  assert.ok(isHttpUrl("https://example.com/x"));
  assert.ok(isHttpUrl("http://example.com"));
  assert.equal(isHttpUrl("ftp://example.com"), false);
  assert.equal(isHttpUrl("--dump=evil"), false);
  assert.equal(isHttpUrl("file:///etc/passwd"), false);
  assert.equal(isHttpUrl(""), false);
  assert.equal(isHttpUrl(undefined), false);
});

test("obscuraFetch builds argv (no shell), maps format→--dump, and adds --stealth by default", async () => {
  let captured;
  const run = async (bin, args, opts) => {
    captured = { bin, args, opts };
    return "PAGE";
  };
  const res = await obscuraFetch(
    "https://example.com/a",
    { format: "markdown", timeoutMs: 30000 },
    run
  );
  assert.equal(res.content, "PAGE");
  assert.equal(res.format, "markdown");
  assert.deepEqual(captured.args, [
    "fetch",
    "https://example.com/a",
    "--dump",
    "markdown",
    "--timeout",
    "30",
    "--quiet",
    "--stealth"
  ]);
  // execa deadline is padded above obscura's own navigation timeout.
  assert.ok(captured.opts.timeoutMs > 30000);
});

test("obscuraFetch: format maps and unknown falls back to markdown; stealth:false omits the flag", async () => {
  const seen = [];
  const run = async (_bin, args) => {
    seen.push(args);
    return "x";
  };
  await obscuraFetch("https://x", { format: "text", stealth: false }, run);
  await obscuraFetch("https://x", { format: "links", stealth: false }, run);
  await obscuraFetch("https://x", { format: "bogus", stealth: false }, run);
  assert.equal(seen[0][seen[0].indexOf("--dump") + 1], "text");
  assert.equal(seen[1][seen[1].indexOf("--dump") + 1], "links");
  assert.equal(seen[2][seen[2].indexOf("--dump") + 1], "markdown");
  assert.ok(!seen[0].includes("--stealth"));
});

test("obscuraFetch: timeout seconds are ceil(ms/1000), min 1", async () => {
  let args;
  const run = async (_b, a) => ((args = a), "x");
  await obscuraFetch("https://x", { timeoutMs: 4200 }, run);
  assert.equal(args[args.indexOf("--timeout") + 1], "5");
});

test("obscuraFetch rejects a non-http(s) URL before spawning anything", async () => {
  let spawned = false;
  const run = async () => ((spawned = true), "x");
  await assert.rejects(() => obscuraFetch("ftp://evil/x", {}, run), /non-http/);
  assert.equal(spawned, false);
});

test("obscuraAvailable reflects whether the runner succeeds", async () => {
  assert.equal(await obscuraAvailable(async () => "obscura 0.1.10"), true);
  assert.equal(
    await obscuraAvailable(async () => {
      throw new Error("ENOENT");
    }),
    false
  );
});
