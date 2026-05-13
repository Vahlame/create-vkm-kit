import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "dist", "index.js");

test("non-interactive --dry-run exits 0 and prints dry-run", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "com-ni-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  const r = spawnSync(process.execPath, [bin, "--non-interactive", "--vault", vault, "--dry-run"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /\[dry-run\]/);
});

test("non-interactive without --vault exits 2", () => {
  const r = spawnSync(process.execPath, [bin, "--non-interactive", "--no-cursor-mcp", "--no-git-init"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
});

test("non-interactive merges into UTF-8 BOM mcp.json without dropping existing servers", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-ni-bom-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "com-ni-bom-v-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  const cursorDir = path.join(home, ".cursor");
  fs.mkdirSync(cursorDir, { recursive: true });
  const prior = {
    mcpServers: {
      "other-server": { command: "echo", args: ["hi"] },
    },
  };
  const bom = "\uFEFF";
  fs.writeFileSync(path.join(cursorDir, "mcp.json"), `${bom}${JSON.stringify(prior)}`, "utf8");
  const r = spawnSync(
    process.execPath,
    [bin, "--non-interactive", "--vault", vault],
    { encoding: "utf8", env: { ...process.env, USERPROFILE: home, HOME: home } },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const merged = JSON.parse(fs.readFileSync(path.join(cursorDir, "mcp.json"), "utf8"));
  assert.ok(merged.mcpServers["other-server"]);
  assert.ok(merged.mcpServers["basic-memory"]);
  assert.equal(merged.mcpServers["basic-memory"].env.BASIC_MEMORY_HOME, vault);
});

test("non-interactive creates vault .vscode/settings.json when missing (Git tuning)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "com-ni-vsc-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "com-ni-vsc-v-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  const r = spawnSync(
    process.execPath,
    [bin, "--non-interactive", "--vault", vault, "--no-cursor-mcp", "--no-git-init"],
    { encoding: "utf8", env: { ...process.env, USERPROFILE: home, HOME: home } },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const fp = path.join(vault, ".vscode", "settings.json");
  assert.ok(fs.existsSync(fp), "expected workspace Git settings");
  const j = JSON.parse(fs.readFileSync(fp, "utf8"));
  assert.equal(j["git.autorefresh"], false);
  assert.equal(j["git.autofetch"], false);
});
