// Plug-and-play vault discovery for the human-facing entry points (GUI server + CLI).
// `requireVault()` alone needs an env var (VKM_VAULT / BASIC_MEMORY_HOME) — fine for MCP
// processes, which get it injected at registration, but a user typing `npm run gui` in a
// fresh shell has none of them (real-world first-run failure, 2026-07-11). Fall back to
// probing the installer's DEFAULT vault location before giving up, and fail with a message
// that says exactly how to fix it.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireVault } from "@vkmikc/obsidian-memory-mcp/src/rag-client.mjs";

/** Same default the installer scaffolds (`defaultVaultPath` in create-vkm-kit). */
export function defaultVaultCandidate() {
  return path.join(os.homedir(), "Documents", "obsidian-memory-vault");
}

/**
 * Resolve the vault: explicit arg > env (requireVault) > the installer's default location
 * (accepted only when it actually looks like a vault — `.obsidian/` present).
 * @param {string} [explicit]
 * @returns {string}
 */
export function locateVault(explicit) {
  try {
    return requireVault(explicit);
  } catch (envError) {
    const candidate = defaultVaultCandidate();
    if (existsSync(path.join(candidate, ".obsidian"))) return candidate;
    throw new Error(
      `${envError.message}\n  (also probed the default location: ${candidate} — not a vault; ` +
        `pass --vault <path> or set VKM_VAULT)`,
      { cause: envError }
    );
  }
}
