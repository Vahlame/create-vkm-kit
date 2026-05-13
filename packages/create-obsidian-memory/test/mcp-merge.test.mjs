import test from "node:test";
import assert from "node:assert/strict";
import { mergeBasicMemoryServer } from "../dist/mcp-merge.mjs";

test("mergeBasicMemoryServer adds basic-memory with absolute vault", () => {
  const out = mergeBasicMemoryServer({}, "/abs/vault");
  assert.equal(out.mcpServers["basic-memory"].command, "uvx");
  assert.deepEqual(out.mcpServers["basic-memory"].args, ["basic-memory", "mcp"]);
  assert.equal(out.mcpServers["basic-memory"].env.BASIC_MEMORY_HOME, "/abs/vault");
});

test("mergeBasicMemoryServer preserves other servers", () => {
  const out = mergeBasicMemoryServer(
    { mcpServers: { other: { command: "true" } } },
    "/v",
  );
  assert.equal(out.mcpServers.other.command, "true");
  assert.ok(out.mcpServers["basic-memory"]);
});
