#!/usr/bin/env node
/**
 * obsidian-prompt-gui — localhost-only HTTP server + a static vanilla-JS page, for
 * people who'd rather click a desktop icon than remember a CLI invocation. Same core as
 * cli.mjs (project-resolve / context-search / compile-xml) — no new framework, no build
 * step, no LLM call. Binds to 127.0.0.1 only; never reachable from the network.
 *
 * If the port's already taken (a previous instance is still running — e.g. the user
 * double-clicked the desktop shortcut twice), just reopen the browser tab on it instead
 * of erroring; the existing instance is presumably fine.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireVault } from "@vkmikc/obsidian-memory-mcp/src/rag-client.mjs";
import { listProjectNames } from "./project-resolve.mjs";
import { searchContext } from "./context-search.mjs";
import { compileOrchestrationPackage } from "./compile-xml.mjs";
import { defaultSystemRole, thinContextNote, backendErrorNote } from "./prompt-defaults.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const DEFAULT_PORT = 4317;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};
/** Project names are filename stems (see project-resolve.mjs) — never path separators. */
const VALID_PROJECT = /^[^/\\]*$/;

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {}); // best-effort: if it fails, the printed URL still works
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data)
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const reqPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const fp = path.resolve(PUBLIC_DIR, `.${reqPath}`);
  if (!fp.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = fs.readFileSync(fp);
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

/** @param {{ vault?: string, lang?: "es"|"en" }} [opts] */
export function createServer({ vault, lang = "es" } = {}) {
  const vaultPath = requireVault(vault);

  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/api/projects") {
        return sendJson(res, 200, { vault: vaultPath, projects: listProjectNames(vaultPath) });
      }

      if (req.method === "POST" && req.url === "/api/compile") {
        const { idea, project } = JSON.parse((await readBody(req)) || "{}");
        if (!idea || !String(idea).trim()) return sendJson(res, 400, { error: "idea vacía" });
        if (project && !VALID_PROJECT.test(project))
          return sendJson(res, 400, { error: "proyecto inválido" });

        const projectNote = project ? `PROJECTS/${project}.md` : null;
        const context = await searchContext({
          vault: vaultPath,
          query: idea,
          projectNote,
          projectName: project || null
        });
        const xml = compileOrchestrationPackage({
          lang,
          systemRole: defaultSystemRole(lang, project || null),
          techStack: context.techStack,
          currentState: context.currentState,
          historicalDecisions: context.historicalDecisions,
          activePatterns: context.activePatterns,
          userIntent: idea,
          note: context.backendError
            ? backendErrorNote(lang, context.backendError)
            : context.usedFallback
              ? thinContextNote(lang)
              : undefined
        });
        return sendJson(res, 200, {
          xml,
          usedFallback: context.usedFallback,
          backendError: context.backendError,
          chars: xml.length,
          approxTokens: Math.round(xml.length / 4)
        });
      }

      return serveStatic(req, res);
    } catch (e) {
      sendJson(res, 500, { error: e?.message || String(e) });
    }
  });
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/**
 * Writes a hidden-window launcher to the Desktop (Windows only — the hidden-run trick is
 * a WScript.Shell-ism). `Run ..., 0, False` = no console flash, don't block. Hardcodes the
 * CURRENT vault/port/lang/node path, same spirit as a desktop app's installed shortcut —
 * it's meant to be regenerated if any of those change.
 * @param {{ vault?: string, lang?: string, port?: number, desktopDir?: string }} opts -
 *   `desktopDir` overrides `~/Desktop` (tests use this so they never touch the real one)
 * @returns {string} the path written
 */
export function installDesktopShortcut({ vault, lang, port, desktopDir } = {}) {
  if (process.platform !== "win32") {
    throw new Error(
      "--install-shortcut solo soporta Windows por ahora (trick .vbs de WScript.Shell)."
    );
  }
  const desktop = desktopDir || path.join(os.homedir(), "Desktop");
  const serverScript = path.join(__dirname, "server.mjs");
  const vaultArg = requireVault(vault); // fail loud now, not when the user double-clicks later
  const args = [
    `"${serverScript}"`,
    "--vault",
    `"${vaultArg}"`,
    "--port",
    String(port || DEFAULT_PORT)
  ];
  if (lang) args.push("--lang", lang);
  const vbs = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.Run "node ${args.join(" ").replace(/"/g, '""')}", 0, False`
  ].join("\r\n");
  const dest = path.join(desktop, "obsidian-prompt.vbs");
  fs.writeFileSync(dest, vbs, "utf8");
  return dest;
}

function main() {
  const argv = process.argv.slice(2);
  const vault = flagValue(argv, "--vault");
  const lang = flagValue(argv, "--lang") === "en" ? "en" : "es";
  const port = Number(flagValue(argv, "--port")) || DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}`;

  if (argv.includes("--install-shortcut")) {
    const dest = installDesktopShortcut({ vault, lang, port });
    console.log(`Acceso directo creado: ${dest}`);
    console.log("Doble-click ahí abre obsidian-prompt sin ventana de consola.");
    return;
  }

  const server = createServer({ vault, lang });
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.log(`Ya hay una instancia corriendo en ${url} — abriendo el navegador ahí.`);
      openBrowser(url);
      return;
    }
    console.error(e.message || e);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`obsidian-prompt-gui en ${url} (Ctrl+C para cerrar)`);
    openBrowser(url);
  });
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) main();
