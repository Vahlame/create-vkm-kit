const UNIT_SECONDS = { h: 3600, m: 60, s: 1 };

/**
 * Parses a compact duration string (e.g. "1h30m", "45s", "2h5s") into a
 * total number of seconds.
 *
 * Rules (strict):
 *  - Only non-negative integers followed by one of the units h/m/s.
 *  - Each unit may appear at most once.
 *  - No whitespace, no decimals, no negative numbers, no missing unit/number.
 *  - Input must consist entirely of valid tokens (no leftover characters).
 *
 * @param {string} s
 * @returns {number} total duration in seconds
 * @throws {TypeError} if `s` is not a string
 * @throws {SyntaxError} if `s` is empty, malformed, or has duplicate units
 */
export function parseDuration(s) {
  if (typeof s !== 'string') {
    throw new TypeError(`parseDuration: expected a string, got ${typeof s}`);
  }

  if (s.length === 0) {
    throw new SyntaxError('parseDuration: input is empty');
  }

  const tokenRe = /(\d+)(h|m|s)/g;
  const seenUnits = new Set();
  let totalSeconds = 0;
  let lastIndex = 0;
  let matchCount = 0;
  let match;

  while ((match = tokenRe.exec(s)) !== null) {
    if (match.index !== lastIndex) {
      throw new SyntaxError(
        `parseDuration: invalid characters in "${s}" at position ${lastIndex}`
      );
    }

    const [full, numStr, unit] = match;

    if (seenUnits.has(unit)) {
      throw new SyntaxError(`parseDuration: duplicate unit "${unit}" in "${s}"`);
    }
    seenUnits.add(unit);

    const value = Number(numStr);
    if (!Number.isInteger(value) || value < 0) {
      throw new SyntaxError(`parseDuration: invalid numeric value "${numStr}" in "${s}"`);
    }

    totalSeconds += value * UNIT_SECONDS[unit];
    lastIndex += full.length;
    matchCount++;
  }

  if (lastIndex !== s.length) {
    throw new SyntaxError(
      `parseDuration: invalid characters in "${s}" at position ${lastIndex}`
    );
  }

  if (matchCount === 0) {
    throw new SyntaxError(`parseDuration: no valid duration tokens found in "${s}"`);
  }

  return totalSeconds;
}
