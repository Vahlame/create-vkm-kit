/**
 * Scoped-memory retrieval filter (frozen contract; one vault per ADR-0074, namespaces are
 * folders inside it: PROJECTS/<name>, AGENTS/<agent-name>).
 *
 * A scope S is a posix-style relative path prefix matched at SEGMENT boundary: a path P is
 * inside S iff P == S, P == S + ".md", or P starts with S + "/". Case-sensitive. Invalid
 * scopes (traversal, absolute paths, drive letters, backslashes) must be REJECTED with an
 * error by the caller — never silently coerced into "no results" or "all results".
 *
 * The same three-way predicate exists in two forms that MUST stay in lockstep:
 * `pathInScope` (JS) and `scopeMatchSql` (parameterized SQL fragment).
 */

/**
 * True when `scope` is a syntactically valid scope value per the frozen contract.
 * Empty strings are NOT valid scopes — callers that want "empty means unscoped" must map
 * that before validating.
 * @param {unknown} scope
 * @returns {boolean}
 */
export function isValidScope(scope) {
  if (typeof scope !== "string" || scope.length === 0) return false;
  if (scope.includes("..")) return false; // traversal
  if (scope.startsWith("/")) return false; // absolute posix path
  if (/^[A-Za-z]:/.test(scope)) return false; // Windows drive letter
  if (scope.includes("\\")) return false; // backslashes: posix-style only
  return true;
}

/**
 * JS mirror of `scopeMatchSql`: segment-boundary prefix match, case-sensitive.
 * @param {string} p - posix-style relative note path (with `.md` for real notes)
 * @param {string} scope - an already-validated scope
 * @returns {boolean}
 */
export function pathInScope(p, scope) {
  return p === scope || p === `${scope}.md` || p.startsWith(`${scope}/`);
}

/**
 * SQL predicate matching `column` against the scope value bound at placeholder `$<idx>`.
 * `column` is a code-controlled identifier (never user input); the scope itself only ever
 * travels as a bind parameter — it is never interpolated into the SQL text.
 * @param {string} column - column or expression to test (e.g. "n.path", "source_path")
 * @param {number} idx - 1-based placeholder index the scope is bound at
 * @returns {string}
 */
export function scopeMatchSql(column, idx) {
  return `(${column} = $${idx} OR ${column} = $${idx} || '.md' OR ${column} LIKE $${idx} || '/%')`;
}
