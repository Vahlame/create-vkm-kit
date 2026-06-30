/**
 * Resolves which `PROJECTS/<name>.md` note (if any) the compiled prompt should pull
 * context from. Reads the vault directly (no Python bridge needed for a directory
 * listing) and falls back to an interactive autocomplete picker when `--project`
 * wasn't passed or doesn't match a single note.
 */
import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";

const NO_PROJECT = { title: "(ninguno / proyecto nuevo)", value: null };

/** @param {string} vault */
export function listProjectNames(vault) {
  try {
    return fs
      .readdirSync(path.join(vault, "PROJECTS"))
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return []; // PROJECTS/ missing or unreadable — proceed with no project context
  }
}

/**
 * @param {object} opts
 * @param {string} opts.vault - absolute vault path
 * @param {string} [opts.projectFlag] - explicit --project value, if given
 * @param {boolean} [opts.nonInteractive] - skip the autocomplete prompt entirely
 * @returns {Promise<{ projectName: string|null, projectNote: string|null, candidates: string[] }>}
 */
export async function resolveProject({ vault, projectFlag, nonInteractive = false }) {
  const names = listProjectNames(vault);

  if (projectFlag) {
    const exact = names.find((n) => n.toLowerCase() === projectFlag.toLowerCase());
    if (exact) return { projectName: exact, projectNote: `PROJECTS/${exact}.md`, candidates: names };
    const partial = names.filter((n) => n.toLowerCase().includes(projectFlag.toLowerCase()));
    if (partial.length === 1) {
      return { projectName: partial[0], projectNote: `PROJECTS/${partial[0]}.md`, candidates: names };
    }
    // zero or multiple matches: fall through to interactive (or give up below) rather
    // than silently guessing which project was meant.
  }

  if (nonInteractive || names.length === 0) {
    return { projectName: projectFlag || null, projectNote: null, candidates: names };
  }

  const { choice } = await prompts({
    type: "autocomplete",
    name: "choice",
    message: "¿Qué proyecto? (escribí para filtrar, Enter en blanco = ninguno/nuevo)",
    choices: [NO_PROJECT, ...names.map((n) => ({ title: n, value: n }))],
    suggest: (input, choices) =>
      Promise.resolve(
        choices.filter((c) => (c.title || "").toLowerCase().includes((input || "").toLowerCase()))
      )
  });

  if (!choice) return { projectName: projectFlag || null, projectNote: null, candidates: names };
  return { projectName: choice, projectNote: `PROJECTS/${choice}.md`, candidates: names };
}
