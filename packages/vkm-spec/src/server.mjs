#!/usr/bin/env node
/**
 * vkm-spec GUI — localhost-only HTTP server + a static vanilla-JS page, for people who'd
 * rather click a desktop icon than remember a CLI invocation. Same core as cli.mjs
 * (assembleContext → compile-xml, optional Ollama draft) — no framework, no build step.
 * Binds to 127.0.0.1 only; never reachable from the network.
 *
 * If the port's already taken (a previous instance is still running — e.g. the user
 * double-clicked the desktop shortcut twice), just reopen the browser tab on it instead of
 * erroring; the existing instance is presumably fine.
 *
 * Routes:
 *  - GET  /                → the static GUI page
 *  - GET  /api/projects    → { vault, projects[] }
 *  - POST /api/assemble    → assembleContext(idea, project) result (retrieval only)
 *  - POST /api/compile     → { xml } from spec fields + context (pure, NO LLM)
 *  - POST /api/draft       → Server-Sent Events: `progress` {tokens}, `done` {spec,xml,source},
 *                            or `error` {message, source:"fallback", spec, xml}. On any Ollama
 *                            failure the `error` frame STILL carries a working deterministic
 *                            spec+xml (the CI-pinned degradation invariant).
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireVault } from "@vkmikc/obsidian-memory-mcp/src/rag-client.mjs";
import { assembleContext } from "@vkmikc/obsidian-memory-mcp/src/context-assemble.mjs";
import { listProjectNames } from "./project-resolve.mjs";
import { compileOrchestrationPackage } from "./compile-xml.mjs";
import { buildSpec } from "./pipeline.mjs";
import { defaultSystemRole, thinContextNote, backendErrorNote } from "./prompt-defaults.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
/** 4923, overridable via VKM_SPEC_PORT. The donor obsidian-prompt-gui used 4317, which
 * collides with the OpenTelemetry OTLP/gRPC default — that collision is WHY this package
 * moved off it (the MCP sidecar's telemetry exporter can hold 4317). Keep away from it. */
const DEFAULT_PORT = Number(process.env.VKM_SPEC_PORT) || 4923;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};
/** Project names are filename stems (see project-resolve.mjs) — never path separators. */
const VALID_PROJECT = /^[^/\\]*$/;

/** Format one SSE frame. Exported (with parseSseFrames) so the wire format has ONE source
 * of truth the tests pin, instead of ad-hoc string-building scattered around. */
export function formatSseEvent(event, dataObj) {
  return `event: ${event}\ndata: ${JSON.stringify(dataObj)}\n\n`;
}

/** Parse a raw SSE buffer into `{ event, data }[]` (data still a JSON string). Inverse of
 * formatSseEvent; used by the server tests to read a streamed response. */
export function parseSseFrames(text) {
  const frames = [];
  for (const block of String(text).split("\n\n")) {
    const trimmed = block.replace(/\r/g, "").trim();
    if (!trimmed) continue;
    let event = "message";
    const dataLines = [];
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
    }
    frames.push({ event, data: dataLines.join("\n") });
  }
  return frames;
}

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

/** @param {{ vault?: string, lang?: "es"|"en", ollamaHost?: string, model?: string }} [opts] */
export function createServer({ vault, lang = "es", ollamaHost, model } = {}) {
  const vaultPath = requireVault(vault);

  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url.split("?")[0] === "/api/projects") {
        return sendJson(res, 200, { vault: vaultPath, projects: listProjectNames(vaultPath) });
      }

      if (req.method === "POST" && req.url === "/api/assemble") {
        const { idea, project } = JSON.parse((await readBody(req)) || "{}");
        if (!idea || !String(idea).trim()) return sendJson(res, 400, { error: "idea vacía" });
        if (project && !VALID_PROJECT.test(project))
          return sendJson(res, 400, { error: "proyecto inválido" });
        const context = await assembleContext({
          vault: vaultPath,
          query: idea,
          projectName: project || undefined
        });
        return sendJson(res, 200, context);
      }

      if (req.method === "POST" && req.url === "/api/compile") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const { idea, project } = body;
        const userIntent = body.userIntent || idea;
        if (!userIntent || !String(userIntent).trim())
          return sendJson(res, 400, { error: "idea vacía" });
        if (project && !VALID_PROJECT.test(project))
          return sendJson(res, 400, { error: "proyecto inválido" });
        const xml = compileOrchestrationPackage({
          lang,
          systemRole: body.systemRole || defaultSystemRole(lang, project || null),
          techStack: body.techStack,
          activeFiles: body.activeFiles,
          currentState: body.currentState || body.currentStateSummary,
          historicalDecisions: body.historicalDecisions,
          activePatterns: body.activePatterns,
          userIntent,
          functionalRequirements: body.functionalRequirements,
          constraints: body.constraints,
          format: body.format,
          note: body.backendError
            ? backendErrorNote(lang, body.backendError)
            : body.usedFallback
              ? thinContextNote(lang)
              : undefined
        });
        return sendJson(res, 200, {
          xml,
          chars: xml.length,
          approxTokens: Math.round(xml.length / 4)
        });
      }

      if (req.method === "POST" && req.url === "/api/draft") {
        return handleDraft(req, res, { vaultPath, lang, ollamaHost, model });
      }

      return serveStatic(req, res);
    } catch (e) {
      sendJson(res, 500, { error: e?.message || String(e) });
    }
  });
}

/** SSE handler: streams `progress` tokens while Ollama drafts, then `done`. On ANY Ollama
 * failure the pipeline degrades internally and returns `source:"fallback"` with a working
 * deterministic xml — we emit that as an `error` frame that STILL carries spec+xml, so the
 * GUI can show a fallback banner while the user still gets a usable prompt. */
async function handleDraft(req, res, { vaultPath, lang, ollamaHost, model }) {
  let idea, project;
  try {
    ({ idea, project } = JSON.parse((await readBody(req)) || "{}"));
  } catch {
    return sendJson(res, 400, { error: "cuerpo inválido" });
  }
  if (!idea || !String(idea).trim()) return sendJson(res, 400, { error: "idea vacía" });
  if (project && !VALID_PROJECT.test(project))
    return sendJson(res, 400, { error: "proyecto inválido" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (event, data) => res.write(formatSseEvent(event, data));

  try {
    const result = await buildSpec({
      idea,
      project: project || null,
      vault: vaultPath,
      lang,
      llm: true,
      ollamaHost,
      model,
      onProgress: (tokens) => send("progress", { tokens })
    });
    if (result.source === "fallback") {
      send("error", {
        message: `Ollama unavailable (${result.ollamaError || "unknown"}) — deterministic fallback used.`,
        source: "fallback",
        spec: result.spec,
        xml: result.xml
      });
    } else {
      send("done", { spec: result.spec, xml: result.xml, source: result.source });
    }
  } catch (e) {
    // A non-degradation bug (not an Ollama failure) — there's no working xml to hand back.
    send("error", { message: e?.message || String(e), source: "fallback", spec: null, xml: null });
  } finally {
    res.end();
  }
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/**
 * Writes a hidden-window launcher to the Desktop (Windows only — the hidden-run trick is a
 * WScript.Shell-ism). `Run ..., 0, False` = no console flash, don't block. Hardcodes the
 * CURRENT vault/port/lang, same spirit as a desktop app's installed shortcut — regenerate
 * it if any of those change.
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
  const dest = path.join(desktop, "vkm-spec.vbs");
  fs.writeFileSync(dest, vbs, "utf8");
  return dest;
}

function main() {
  const argv = process.argv.slice(2);
  const vault = flagValue(argv, "--vault");
  const lang = flagValue(argv, "--lang") === "en" ? "en" : "es";
  const ollamaHost = flagValue(argv, "--ollama-host");
  const port = Number(flagValue(argv, "--port")) || DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}`;

  if (argv.includes("--install-shortcut")) {
    const dest = installDesktopShortcut({ vault, lang, port });
    console.log(`Acceso directo creado: ${dest}`);
    console.log("Doble-click ahí abre vkm-spec sin ventana de consola.");
    return;
  }

  const server = createServer({ vault, lang, ollamaHost });
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
    console.log(`vkm-spec GUI en ${url} (Ctrl+C para cerrar)`);
    openBrowser(url);
  });
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) main();
