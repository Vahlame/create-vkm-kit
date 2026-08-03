/**
 * Wizard prompt labels and the run summary's fixed lines, per language.
 *
 * Spanish is the default and English is opt-in via `--lang en` — this CLI is
 * Spanish-first by design, not by omission. Only strings the INTERACTIVE flow shows
 * live here; flag help lives in `cli/help.mjs` and is English-only, because a flag
 * name is not translated and neither is the sentence describing it.
 *
 * @module
 */

export const messages = {
  es: {
    title: "create-vkm-kit",
    vaultQ: "Ruta del vault (debe contener .obsidian o crearemos uno)",
    createVault: "Crear un vault nuevo en ~/Documents/obsidian-memory-vault",
    ides: "IDEs a configurar (espacio para MCP)",
    gitleaks: "Activar hook pre-commit gitleaks",
    summary: "Listo. Pasos siguientes",
    otherIdes: "Copia este bloque MCP en la config del IDE:",
    ftsHint:
      "Opcional (vaults grandes): MCP obsidian-memory-hybrid (tras pip install -e …/obsidian-memory-rag) o obsidian-memory-rag index manual; ver docs/es/instalacion.md (Verificación).",
    hybridQ:
      "¿Añadir MCP obsidian-memory-hybrid (FTS5 / BM25) además de basic-memory? (requiere clon del kit y pip install -e packages/obsidian-memory-rag)",
    semanticQ:
      "¿Usar embeddings neuronales (fastembed) para recall por significado? (requiere el extra [semantic])",
    pgQ: "¿Activar la proyección Postgres de la memoria (PGlite embebido, tiempo real)?",
    consoleQ:
      "¿Compilar la consola vkm-console (TUI en Go: actividad del vault, grafo y búsqueda; requiere Go)?",
    rulesQ:
      "¿Instalar las reglas de memoria en CLAUDE.md / AGENTS.md / .cursor? (bloque marcado; no pisa tu contenido)"
  },
  en: {
    title: "create-vkm-kit",
    vaultQ: "Vault path (must contain .obsidian or we create a sample)",
    createVault: "Create a new vault at ~/Documents/obsidian-memory-vault",
    ides: "IDEs to wire for MCP",
    gitleaks: "Enable gitleaks pre-commit hook",
    summary: "Done. Next steps",
    otherIdes: "Paste this MCP block into each IDE's config:",
    ftsHint:
      "Optional (large vaults): obsidian-memory-hybrid MCP (after pip install -e …/obsidian-memory-rag) or manual obsidian-memory-rag index; see docs/en/install.md (Verification).",
    hybridQ:
      "Add obsidian-memory-hybrid MCP (FTS5 / BM25) in addition to basic-memory? (needs this repo clone + pip install -e packages/obsidian-memory-rag)",
    semanticQ:
      "Use neural embeddings (fastembed) for meaning-based recall? (needs the [semantic] extra)",
    pgQ: "Enable the Postgres memory projection (embedded PGlite, real-time)?",
    consoleQ: "Build the vkm-console TUI (Go: live vault activity, graph and search; needs Go)?",
    rulesQ:
      "Install the memory rules into CLAUDE.md / AGENTS.md / .cursor? (marked block; won't clobber your content)"
  }
};

/** @typedef {keyof typeof messages} Lang */

/**
 * The label set for `lang`, falling back to Spanish for anything unrecognized.
 * @param {string} lang
 */
export function messagesFor(lang) {
  return messages[/** @type {Lang} */ (lang)] ?? messages.es;
}
