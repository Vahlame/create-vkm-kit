#!/usr/bin/env node
/**
 * Local, read-only static server for visually verifying repo assets (SVG diagrams,
 * images) in a browser. Exists because agent browser panes commonly block file://
 * navigation, and GitHub renders docs/assets/*.svg with prefers-color-scheme theming
 * that is easiest to check in a live browser (flip the theme via OS setting or
 * DevTools "Emulate CSS prefers-color-scheme").
 *
 * Usage:
 *   npm run preview:assets            # http://127.0.0.1:4180/ → docs/assets/ listing
 *   PORT=5000 npm run preview:assets  # pick another port
 *
 * Security: binds 127.0.0.1 only, GET/HEAD only, serves paths strictly inside the
 * repo root (traversal-safe), follows no symlinks out of it, and never lists or
 * serves dotfiles (.git, .env, …).
 */
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 4180;

const MIME = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Resolve a URL path to a real filesystem path inside ROOT, or null if unsafe. */
async function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  if (decoded.split("/").some((seg) => seg.startsWith(".") && seg !== "")) return null;
  const abs = path.resolve(ROOT, "." + decoded);
  let real;
  try {
    real = await fs.realpath(abs);
  } catch {
    return null;
  }
  const realRoot = await fs.realpath(ROOT);
  return real === realRoot || real.startsWith(realRoot + path.sep) ? real : null;
}

async function listDir(absDir, urlPath) {
  const entries = (await fs.readdir(absDir, { withFileTypes: true }))
    .filter((e) => !e.name.startsWith("."))
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
    );
  const rows = entries
    .map((e) => {
      const href =
        path.posix.join(urlPath, encodeURIComponent(e.name)) + (e.isDirectory() ? "/" : "");
      return `<li><a href="${esc(href)}">${esc(e.name)}${e.isDirectory() ? "/" : ""}</a></li>`;
    })
    .join("\n");
  const up =
    urlPath !== "/" ? `<p><a href="${esc(path.posix.join(urlPath, ".."))}">&larr; up</a></p>` : "";
  return `<!doctype html><meta charset="utf-8"><title>${esc(urlPath)}</title>
<body style="font:14px ui-monospace,monospace;margin:2rem;color-scheme:light dark">
<h1 style="font-size:16px">${esc(urlPath)}</h1>${up}<ul>${rows}</ul></body>`;
}

async function handleRequest(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      return res.end("method not allowed");
    }
    if (req.url === "/") {
      res.statusCode = 302;
      res.setHeader("location", "/docs/assets/");
      return res.end();
    }
    const abs = await safeResolve(req.url);
    if (!abs) {
      res.statusCode = 404;
      return res.end("not found");
    }
    const st = await fs.stat(abs);
    if (st.isDirectory()) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(await listDir(abs, req.url.split("?")[0]));
    }
    res.setHeader(
      "content-type",
      MIME[path.extname(abs).toLowerCase()] || "application/octet-stream"
    );
    res.setHeader("cache-control", "no-store");
    return res.end(req.method === "HEAD" ? undefined : await fs.readFile(abs));
  } catch {
    res.statusCode = 500;
    res.end("error");
  }
}

const server = createServer((req, res) => {
  // handleRequest catches everything itself; this is a last-resort socket guard
  handleRequest(req, res).catch(() => res.destroy());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`preview-assets: http://127.0.0.1:${PORT}/  (root: ${ROOT})`);
  console.log(
    "dark mode: flip your OS theme, or DevTools → Rendering → Emulate prefers-color-scheme"
  );
});
