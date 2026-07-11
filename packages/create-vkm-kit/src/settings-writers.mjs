// Pure merge/remove writers for the settings.json sections the token-saver and telemetry
// modules manage: `env`, `permissions.{deny,allow}` and `outputStyle`.
//
// Same contract as the hook mergers in `settings-io.mjs`: never mutate the input, preserve
// every unrelated key/entry, be idempotent under re-runs, and on removal only reverse what
// we can PROVE is ours — a value the user has since changed is left alone (the same
// principle `removeSessionStartHook` applies to `autoMemoryEnabled`). Emptied sections are
// deleted entirely so an uninstalled kit leaves no trace.
//
// Nothing here does I/O or logs; orchestrators own the read→merge→write flow via
// `readSettingsSafe`/`atomicWriteJson` from `settings-io.mjs`.

/** Shallow-copy `existing` when it's a plain object; otherwise start fresh (same guard the
 * hook mergers use — a corrupt/array/null settings value must never crash a merge). */
function asSettingsObject(existing) {
  return existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...existing }
    : {};
}

/** Plain-object guard for a nested section (`env`, `permissions`). */
function asSection(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

/**
 * Set every `envMap` key in `settings.env`, preserving unrelated env vars. Last write wins
 * for our own keys (re-runs converge). `envMap` values are coerced to strings — settings
 * env blocks are string-valued.
 * @param {unknown} existing - parsed `settings.json` (or anything; non-objects are ignored)
 * @param {Record<string, string | number | boolean>} envMap
 * @returns {Record<string, unknown>}
 */
export function mergeManagedEnv(existing, envMap) {
  const settings = asSettingsObject(existing);
  const env = asSection(settings.env);
  for (const [key, value] of Object.entries(envMap ?? {})) {
    env[key] = String(value);
  }
  settings.env = env;
  return settings;
}

/**
 * The removal counterpart to {@link mergeManagedEnv}: delete each `envMap` key from
 * `settings.env` ONLY when its current value is still exactly what this kit would have set
 * — a user-tuned value (e.g. a custom OTLP endpoint) is never silently reverted. Deletes
 * the `env` section entirely when removal empties it.
 * @param {unknown} existing
 * @param {Record<string, string | number | boolean>} envMap - keys + the values we set
 * @returns {Record<string, unknown>}
 */
export function removeManagedEnv(existing, envMap) {
  const settings = asSettingsObject(existing);
  if (!settings.env || typeof settings.env !== "object" || Array.isArray(settings.env)) {
    return settings;
  }
  const env = { ...settings.env };
  for (const [key, value] of Object.entries(envMap ?? {})) {
    if (env[key] === String(value)) delete env[key];
  }
  if (Object.keys(env).length) settings.env = env;
  else delete settings.env;
  return settings;
}

/** Append `rules` to `list` preserving the user's order and entries; ours land at the end,
 * deduped by exact string so re-runs never duplicate. */
function mergeRuleList(list, rules) {
  const prior = Array.isArray(list) ? [...list] : [];
  for (const rule of rules) {
    if (!prior.includes(rule)) prior.push(rule);
  }
  return prior;
}

/**
 * Merge managed permission rules into `settings.permissions.{deny,allow}` (exact-string
 * dedup; user rules and their order preserved; ours appended).
 * @param {unknown} existing
 * @param {{ deny?: string[], allow?: string[] }} rules
 * @returns {Record<string, unknown>}
 */
export function mergeManagedPermissions(existing, { deny = [], allow = [] } = {}) {
  const settings = asSettingsObject(existing);
  const permissions = asSection(settings.permissions);
  if (deny.length) permissions.deny = mergeRuleList(permissions.deny, deny);
  if (allow.length) permissions.allow = mergeRuleList(permissions.allow, allow);
  settings.permissions = permissions;
  return settings;
}

/**
 * The removal counterpart to {@link mergeManagedPermissions}: strip exactly the given rule
 * strings, leaving every other rule (the user's own) untouched. Emptied arrays and an
 * emptied `permissions` section are deleted entirely.
 * @param {unknown} existing
 * @param {{ deny?: string[], allow?: string[] }} rules
 * @returns {Record<string, unknown>}
 */
export function removeManagedPermissions(existing, { deny = [], allow = [] } = {}) {
  const settings = asSettingsObject(existing);
  if (
    !settings.permissions ||
    typeof settings.permissions !== "object" ||
    Array.isArray(settings.permissions)
  ) {
    return settings;
  }
  const permissions = { ...settings.permissions };
  for (const [key, ours] of [
    ["deny", deny],
    ["allow", allow]
  ]) {
    if (!Array.isArray(permissions[key])) continue;
    const kept = permissions[key].filter((rule) => !ours.includes(rule));
    if (kept.length) permissions[key] = kept;
    else delete permissions[key];
  }
  if (Object.keys(permissions).length) settings.permissions = permissions;
  else delete settings.permissions;
  return settings;
}

/**
 * Set `settings.outputStyle` to the kit-shipped style. Overwrites a prior value — the
 * install flow only calls this when the user opted in (default ON under `--full`), and the
 * removal below refuses to touch anything that isn't exactly ours.
 * @param {unknown} existing
 * @param {string} name - output style name (e.g. "vkm-terse")
 * @returns {Record<string, unknown>}
 */
export function setManagedOutputStyle(existing, name) {
  const settings = asSettingsObject(existing);
  settings.outputStyle = name;
  return settings;
}

/**
 * The removal counterpart to {@link setManagedOutputStyle}: delete `outputStyle` ONLY when
 * it still points at our style — a user who switched styles afterwards keeps their choice.
 * @param {unknown} existing
 * @param {string} name
 * @returns {Record<string, unknown>}
 */
export function clearManagedOutputStyle(existing, name) {
  const settings = asSettingsObject(existing);
  if (settings.outputStyle === name) delete settings.outputStyle;
  return settings;
}
