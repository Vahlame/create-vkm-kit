import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, installDesktopShortcut } from "../src/server.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ragSrc = path.join(root, "packages", "obsidian-memory-rag", "src");
const py = process.platform === "win32" ? "python" : "python3";

function indexedVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-compiler-srv-"));
  fs.mkdirSync(path.join(vault, ".obsidian"));
  fs.mkdirSync(path.join(vault, "PROJECTS"));
  fs.writeFileSync(path.join(vault, "PROJECTS", "demo.md"), "# demo\n- [decision] usar SQLite #db\n", "utf8");
  const env = { ...process.env, PYTHONPATH: ragSrc };
  const r = spawnSync(py, ["-m", "obsidian_memory_rag", "json-index", "--vault", vault], { encoding: "utf8", env });
  return r.status === 0 ? vault : null;
}

function withServer(vault, fn) {
  process.env.OBSIDIAN_MEMORY_RAG_SRC = ragSrc;
  const server = createServer({ vault });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      try {
        await fn(`http://127.0.0.1:${port}`);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        delete process.env.OBSIDIAN_MEMORY_RAG_SRC;
        server.close();
      }
    });
  });
}

test("GET /api/projects lists PROJECTS/*.md stems", async (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  await withServer(vault, async (base) => {
    const r = await fetch(`${base}/api/projects`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.deepEqual(data.projects, ["demo"]);
  });
});

test("POST /api/compile returns a complete orchestration_package", async (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  await withServer(vault, async (base) => {
    const r = await fetch(`${base}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "agregar JWT", project: "demo" })
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.match(data.xml, /<orchestration_package>/);
    assert.match(data.xml, /usar SQLite #db/);
    assert.equal(typeof data.chars, "number");
    assert.equal(typeof data.approxTokens, "number");
  });
});

test("POST /api/compile rejects an empty idea", async (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  await withServer(vault, async (base) => {
    const r = await fetch(`${base}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "  " })
    });
    assert.equal(r.status, 400);
  });
});

test("POST /api/compile rejects a path-traversal project name", async (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  await withServer(vault, async (base) => {
    const r = await fetch(`${base}/api/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "algo", project: "../../etc/passwd" })
    });
    assert.equal(r.status, 400);
  });
});

test("GET / serves the static index.html", async (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  await withServer(vault, async (base) => {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    const body = await r.text();
    assert.match(body, /<title>obsidian-prompt<\/title>/);
  });
});

test("static file serving refuses to escape the public/ directory", async (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  await withServer(vault, async (base) => {
    const r = await fetch(`${base}/../package.json`);
    assert.ok(r.status === 403 || r.status === 404, `expected 403/404, got ${r.status}`);
  });
});

test("installDesktopShortcut writes a hidden, non-blocking launcher (Windows only)", { skip: process.platform !== "win32" }, () => {
  const desktopDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-compiler-desktop-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-compiler-desktop-vault-"));
  const dest = installDesktopShortcut({ vault, port: 4321, lang: "en", desktopDir });
  assert.equal(dest, path.join(desktopDir, "obsidian-prompt.vbs"));
  const content = fs.readFileSync(dest, "utf8");
  assert.match(content, /CreateObject\("WScript\.Shell"\)/);
  assert.match(content, /\.Run "node .*", 0, False/, "hidden window (0) and non-blocking (False)");
  assert.match(content, /--port 4321/);
  assert.match(content, /--lang en/);
  assert.ok(content.includes(vault), "vault path is baked into the launcher");
});

test("installDesktopShortcut requires a resolvable vault", { skip: process.platform !== "win32" }, () => {
  const desktopDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-compiler-desktop2-"));
  const saved = { BASIC_MEMORY_HOME: process.env.BASIC_MEMORY_HOME, OBSIDIAN_MEMORY_VAULT: process.env.OBSIDIAN_MEMORY_VAULT };
  delete process.env.BASIC_MEMORY_HOME;
  delete process.env.OBSIDIAN_MEMORY_VAULT;
  try {
    assert.throws(() => installDesktopShortcut({ vault: undefined, desktopDir, port: 4321 }), /Missing vault/);
  } finally {
    if (saved.BASIC_MEMORY_HOME !== undefined) process.env.BASIC_MEMORY_HOME = saved.BASIC_MEMORY_HOME;
    if (saved.OBSIDIAN_MEMORY_VAULT !== undefined) process.env.OBSIDIAN_MEMORY_VAULT = saved.OBSIDIAN_MEMORY_VAULT;
  }
});

test("GET /does-not-exist returns 404", async (t) => {
  const vault = indexedVault();
  if (!vault) {
    t.skip("Python backend not runnable in this environment");
    return;
  }
  await withServer(vault, async (base) => {
    const r = await fetch(`${base}/does-not-exist`);
    assert.equal(r.status, 404);
  });
});
