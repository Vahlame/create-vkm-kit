import test from "node:test";
import assert from "node:assert/strict";
import { asTextResult, asErrorResult, toolHandler } from "../src/mcp-result.mjs";

test("asTextResult: strings are emitted verbatim (no isError)", () => {
  const r = asTextResult("hello\nworld");
  assert.deepEqual(r, { content: [{ type: "text", text: "hello\nworld" }] });
  assert.equal(r.isError, undefined);
});

test("asTextResult: objects are compact JSON (no pretty-print indentation)", () => {
  const r = asTextResult({ a: 1, b: [2, 3] });
  assert.equal(r.content[0].text, JSON.stringify({ a: 1, b: [2, 3] }));
  assert.ok(!r.content[0].text.includes("\n"), "compact JSON must not contain newlines");
});

test("asErrorResult: Error uses message and sets isError", () => {
  const r = asErrorResult(new Error("boom"));
  assert.equal(r.content[0].text, "boom");
  assert.equal(r.isError, true);
});

test("asErrorResult: non-Error value is stringified", () => {
  const r = asErrorResult("plain");
  assert.equal(r.content[0].text, "plain");
  assert.equal(r.isError, true);
});

test("toolHandler: resolved object becomes a compact JSON text result", async () => {
  const handler = toolHandler(async ({ n }) => ({ doubled: n * 2 }));
  const r = await handler({ n: 21 });
  assert.equal(r.content[0].text, JSON.stringify({ doubled: 42 }));
  assert.equal(r.isError, undefined);
});

test("toolHandler: resolved string is emitted verbatim (raw file reads)", async () => {
  const handler = toolHandler(async () => "raw file contents");
  const r = await handler({});
  assert.deepEqual(r, { content: [{ type: "text", text: "raw file contents" }] });
});

test("toolHandler: thrown error becomes an isError result", async () => {
  const handler = toolHandler(async () => {
    throw new Error("nope");
  });
  const r = await handler({});
  assert.equal(r.content[0].text, "nope");
  assert.equal(r.isError, true);
});

test("toolHandler: synchronous return value is supported", async () => {
  const handler = toolHandler(() => "sync");
  const r = await handler({});
  assert.equal(r.content[0].text, "sync");
});
