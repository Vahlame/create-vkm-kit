/**
 * MCP sidecar: BM25 vault search + incremental index via obsidian-memory-rag (FTS5).
 * Stdio transport. Requires Python 3.11+ with the `obsidian-memory-rag` package on PYTHONPATH
 * (monorepo layout) or pip-installed `obsidian-memory-rag`.
 *
 * Env:
 * - BASIC_MEMORY_HOME or OBSIDIAN_MEMORY_VAULT — default vault when a tool omits `vault`
 * - OBSIDIAN_MEMORY_RAG_SRC — override path to .../obsidian-memory-rag/src
 * - OBSIDIAN_MEMORY_PYTHON — python executable (default: python3 non-Windows, python on Windows)
 */
import { execa } from "execa";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { extractBullets, pickQueryTerms } from "./extract.mjs";

// Re-export so any consumer that already imports these from hybrid-mcp.mjs keeps
// working; new consumers should import from ./extract.mjs to avoid loading the
// whole MCP server module.
export { extractBullets, pickQueryTerms };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultPython() {
  if (process.env.OBSIDIAN_MEMORY_PYTHON) return process.env.OBSIDIAN_MEMORY_PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

function defaultVaultFromEnv() {
  const raw = process.env.BASIC_MEMORY_HOME || process.env.OBSIDIAN_MEMORY_VAULT;
  if (!raw) return null;
  return path.resolve(raw);
}

function defaultRagSrc() {
  if (process.env.OBSIDIAN_MEMORY_RAG_SRC) {
    return path.resolve(process.env.OBSIDIAN_MEMORY_RAG_SRC);
  }
  return path.resolve(__dirname, "../../obsidian-memory-rag/src");
}

function requireVault(vaultArg) {
  const v = vaultArg ? path.resolve(vaultArg) : defaultVaultFromEnv();
  if (!v) {
    throw new Error(
      "Missing vault: pass `vault` on the tool call or set BASIC_MEMORY_HOME / OBSIDIAN_MEMORY_VAULT"
    );
  }
  return v;
}

async function runRagJson(args, ragSrc) {
  const py = defaultPython();
  const env = { ...process.env };
  const parts = [ragSrc, env.PYTHONPATH].filter(Boolean);
  env.PYTHONPATH = parts.join(path.delimiter);
  const r = await execa(py, ["-m", "obsidian_memory_rag", ...args], {
    env,
    reject: false,
    stripFinalNewline: true
  });
  if (r.exitCode !== 0) {
    throw new Error(r.stderr || r.stdout || `python exited ${r.exitCode}`);
  }
  return JSON.parse(r.stdout);
}

async function main() {
  const ragSrc = defaultRagSrc();

  const server = new McpServer(
    { name: "obsidian-memory-hybrid", version: "2.0.0-beta.2" },
    {
      capabilities: { tools: {} },
      instructions:
        "Hybrid lexical memory: call vault_fts_index after large vault imports, then vault_fts_search for BM25-ranked Markdown hits. Complements basic-memory; does not replace it."
    }
  );

  server.registerTool(
    "vault_fts_search",
    {
      title: "Vault FTS5 search",
      description:
        "BM25 search over the local SQLite FTS5 index built by obsidian-memory-rag. Run vault_fts_index first if results are empty.",
      inputSchema: {
        query: z.string().describe("Space-separated terms (AND on note body)"),
        vault: z
          .string()
          .optional()
          .describe("Vault root; defaults to BASIC_MEMORY_HOME / OBSIDIAN_MEMORY_VAULT"),
        limit: z.number().int().min(1).max(100).optional().default(20)
      },
      annotations: { readOnlyHint: true }
    },
    async ({ query, vault, limit }) => {
      try {
        const v = requireVault(vault || undefined);
        const data = await runRagJson(
          ["json-search", "--vault", v, "--query", query, "--limit", String(limit ?? 20)],
          ragSrc
        );
        const text = JSON.stringify(data, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );

  server.registerTool(
    "vault_fts_index",
    {
      title: "Vault FTS5 incremental index",
      description:
        "Refresh the local .obsidian-memory-rag/fts.sqlite index (incremental by mtime/size).",
      inputSchema: {
        vault: z.string().optional().describe("Vault root; defaults to BASIC_MEMORY_HOME"),
        maxFileBytes: z.number().int().min(4096).max(10_000_000).optional().default(1_048_576)
      },
      annotations: { readOnlyHint: false }
    },
    async ({ vault, maxFileBytes }) => {
      try {
        const v = requireVault(vault || undefined);
        const data = await runRagJson(
          ["json-index", "--vault", v, "--max-file-bytes", String(maxFileBytes ?? 1_048_576)],
          ragSrc
        );
        const text = JSON.stringify(data, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );

  server.registerTool(
    "memory_extract_candidates",
    {
      title: "Memory extraction candidates (pre-close ritual)",
      description:
        "Given a free-text summary of the task/turn just finished, returns bullet candidates that the agent SHOULD propose to the human before appending to MEMORY.md. For each bullet, looks up existing entries via BM25/FTS5 and flags potential duplicates. NEVER writes to the vault — the human approves and the agent then calls write_note / edit_note. Use this at the closing-ritual moment defined in the User Rules.",
      inputSchema: {
        summary: z
          .string()
          .describe(
            "Free-text recap of what happened that might be worth remembering long-term (decisions, preferences, lessons)."
          ),
        vault: z.string().optional().describe("Vault root; defaults to BASIC_MEMORY_HOME"),
        memoryFile: z
          .string()
          .optional()
          .default("MEMORY.md")
          .describe("Path relative to vault to dedup against (default MEMORY.md)"),
        maxBullets: z.number().int().min(1).max(20).optional().default(6)
      },
      annotations: { readOnlyHint: true }
    },
    async ({ summary, vault, memoryFile, maxBullets }) => {
      try {
        const v = requireVault(vault || undefined);
        const file = memoryFile || "MEMORY.md";
        const bullets = extractBullets(summary).slice(0, maxBullets ?? 6);
        const candidates = [];
        for (const bullet of bullets) {
          const terms = pickQueryTerms(bullet);
          let existing = null;
          if (terms) {
            try {
              const data = await runRagJson(
                ["json-search", "--vault", v, "--query", terms, "--limit", "5"],
                ragSrc
              );
              const hit = (data.hits || []).find((h) => h.path === file);
              if (hit) {
                existing = { path: hit.path, snippet: hit.snippet ?? "" };
              }
            } catch {
              // Index missing or query parse error → fall through; bullet is just flagged as new.
            }
          }
          candidates.push({ bullet, query: terms, existing });
        }
        const payload = {
          memoryFile: file,
          candidates,
          notice:
            "These are candidates only. Show them to the human, get explicit confirmation, then call write_note / edit_note. Never auto-append."
        };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Guard so importing this module (e.g. from a test) does NOT spawn the stdio
// server. Without this guard, `node --test` runs that import hybrid-mcp.mjs
// hang forever because StdioServerTransport waits on stdin.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
