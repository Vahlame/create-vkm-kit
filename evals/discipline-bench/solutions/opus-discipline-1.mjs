// parseDuration.mjs — parse a compact duration string ("1h30m") into total seconds.
//
// Strict by design (the domain is "a duration"): units are h/m/s, each may appear
// at most once, in canonical descending order (h → m → s), and every segment must be
// a non-negative integer count. Anything else is a malformed input and throws a typed
// error rather than returning a silent partial result.

const UNIT_SECONDS = { h: 3600, m: 60, s: 1 };
const UNIT_RANK = { h: 0, m: 1, s: 2 };

/**
 * Parse a compact duration string into a total number of seconds.
 *
 * @param {string} s - e.g. "1h30m", "90s", "2h30m15s".
 * @returns {number} total seconds (non-negative integer).
 * @throws {TypeError}   if `s` is not a string.
 * @throws {SyntaxError} if `s` is empty or not a well-formed duration.
 */
export function parseDuration(s) {
  if (typeof s !== 'string') {
    throw new TypeError(`parseDuration: expected a string, got ${typeof s}`);
  }

  const str = s.trim();
  if (str === '') {
    throw new SyntaxError('parseDuration: empty duration string');
  }

  const segment = /(\d+)([hms])/g;
  let total = 0;
  let cursor = 0; // must stay contiguous from the start — no stray characters
  let prevRank = -1;
  const seen = new Set();
  let match;

  while ((match = segment.exec(str)) !== null) {
    if (match.index !== cursor) {
      // a gap means something before this segment wasn't a valid unit
      throw new SyntaxError(`parseDuration: unexpected input in ${JSON.stringify(s)}`);
    }

    const [, digits, unit] = match;

    if (seen.has(unit)) {
      throw new SyntaxError(`parseDuration: duplicate unit "${unit}" in ${JSON.stringify(s)}`);
    }
    if (UNIT_RANK[unit] < prevRank) {
      throw new SyntaxError(`parseDuration: units out of order in ${JSON.stringify(s)}`);
    }

    // `digits` is guaranteed all-digits by the regex → a safe non-negative integer.
    total += Number(digits) * UNIT_SECONDS[unit];
    seen.add(unit);
    prevRank = UNIT_RANK[unit];
    cursor = segment.lastIndex;
  }

  if (cursor !== str.length) {
    // trailing garbage, or nothing matched at all
    throw new SyntaxError(`parseDuration: unexpected input in ${JSON.stringify(s)}`);
  }

  return total;
}
