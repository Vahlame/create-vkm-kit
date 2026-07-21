/**
 * Parses a compact duration string (e.g. "1h30m", "45s", "2h") into a total
 * number of seconds. Supported units: h (hours), m (minutes), s (seconds),
 * each appearing at most once, in that order (h before m before s).
 *
 * Strict grammar: `^(\d+h)?(\d+m)?(\d+s)?$`, with at least one unit present
 * and non-negative integer magnitudes only (no signs, no decimals, no
 * whitespace, no repeated/out-of-order units, no trailing garbage).
 *
 * @param {string} s - duration string, e.g. "1h30m"
 * @returns {number} total duration in seconds
 * @throws {TypeError} if `s` is not a string
 * @throws {Error} if `s` is empty or does not match the strict grammar above
 */
export function parseDuration(s) {
  if (typeof s !== 'string') {
    throw new TypeError(`parseDuration: expected a string, got ${typeof s}`);
  }
  if (s.length === 0) {
    throw new Error('parseDuration: duration string must not be empty');
  }

  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);

  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) {
    throw new Error(
      `parseDuration: invalid duration string "${s}" (expected e.g. "1h30m", "45s"; units h/m/s, integers only, in order)`
    );
  }

  const [, hoursStr, minutesStr, secondsStr] = match;

  const hours = hoursStr === undefined ? 0 : Number(hoursStr);
  const minutes = minutesStr === undefined ? 0 : Number(minutesStr);
  const seconds = secondsStr === undefined ? 0 : Number(secondsStr);

  const total = hours * 3600 + minutes * 60 + seconds;

  if (!Number.isSafeInteger(total)) {
    throw new Error(`parseDuration: duration "${s}" is too large to represent safely`);
  }

  return total;
}
