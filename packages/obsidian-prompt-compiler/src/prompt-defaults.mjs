/** Shared copy between cli.mjs and server.mjs — kept in one place so the CLI and the
 * GUI server never drift on what the compiled prompt actually says. */

/** @param {"es"|"en"} lang @param {string|null} [projectName] */
export function defaultSystemRole(lang, projectName) {
  const project = projectName || (lang === "en" ? "this project" : "este proyecto");
  return lang === "en"
    ? `You are a senior, precise, concise software engineer working on ${project}. Follow its existing conventions; don't introduce new ones without saying so.`
    : `Sos un ingeniero de software senior, preciso y conciso, trabajando en ${project}. Seguí sus convenciones existentes; no introduzcas nuevas sin decirlo.`;
}

/** @param {"es"|"en"} lang */
export function thinContextNote(lang) {
  return lang === "en"
    ? "The context above was fetched automatically from a knowledge base. If it looks thin or off-target, ASK for more detail instead of assuming."
    : "El contexto de arriba se buscó automáticamente en una base de conocimiento. Si parece escaso o desviado, PREGUNTÁ por más detalle en vez de asumir.";
}

/** Distinct from thinContextNote: the vault search backend itself failed (e.g. a broken
 * Python venv), so the empty context below is NOT evidence of "nothing on record" — it's
 * evidence the search never ran. @param {"es"|"en"} lang @param {string} detail */
export function backendErrorNote(lang, detail) {
  return lang === "en"
    ? `Vault search backend failed (${detail}) — the sections above are empty because the search couldn't run, not because the vault has nothing on this. Fix the backend before trusting this package.`
    : `La búsqueda en el vault falló (${detail}) — las secciones de arriba están vacías porque la búsqueda no pudo correr, no porque el vault no tenga nada. Arreglá el backend antes de confiar en este paquete.`;
}
