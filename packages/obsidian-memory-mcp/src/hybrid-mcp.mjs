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
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
  return path.resolve(__dirname, "../obsidian-memory-rag/src");
}

function requireVault(vaultArg) {
  const v = vaultArg ? path.resolve(vaultArg) : defaultVaultFromEnv();
  if (!v) {
    throw new Error(
      "Missing vault: pass `vault` on the tool call or set BASIC_MEMORY_HOME / OBSIDIAN_MEMORY_VAULT",
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
    stripFinalNewline: true,
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
        "Hybrid lexical memory: call vault_fts_index after large vault imports, then vault_fts_search for BM25-ranked Markdown hits. Complements basic-memory; does not replace it.",
    },
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
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, vault, limit }) => {
      try {
        const v = requireVault(vault || undefined);
        const data = await runRagJson(
          ["json-search", "--vault", v, "--query", query, "--limit", String(limit ?? 20)],
          ragSrc,
        );
        const text = JSON.stringify(data, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    },
  );

  server.registerTool(
    "vault_fts_index",
    {
      title: "Vault FTS5 incremental index",
      description:
        "Refresh the local .obsidian-memory-rag/fts.sqlite index (incremental by mtime/size).",
      inputSchema: {
        vault: z.string().optional().describe("Vault root; defaults to BASIC_MEMORY_HOME"),
        maxFileBytes: z.number().int().min(4096).max(10_000_000).optional().default(1_048_576),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ vault, maxFileBytes }) => {
      try {
        const v = requireVault(vault || undefined);
        const data = await runRagJson(
          [
            "json-index",
            "--vault",
            v,
            "--max-file-bytes",
            String(maxFileBytes ?? 1_048_576),
          ],
          ragSrc,
        );
        const text = JSON.stringify(data, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
