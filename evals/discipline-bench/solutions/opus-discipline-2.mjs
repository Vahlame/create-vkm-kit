// parseDuration(s) — parse a compact duration string ("1h30m") into total seconds.
// Units: h (hours), m (minutes), s (seconds). Named ESM export.
//
// Domain contract (inferred strictly per spec):
//  - Input must be a non-empty string.
//  - Composed of one or more `<integer><unit>` segments, e.g. "1h", "30m", "45s", "1h30m".
//  - Counts are non-negative integers only: reject "-1h", "1.5h", "1e3h", "0x1h".
//  - Each unit may appear at most once, and units must be in descending order (h, m, s)
//    to avoid ambiguous/duplicate input like "1m1h" or "1h1h".
//  - No stray characters, whitespace, or trailing/leading noise.
// On any violation: throw a TypeError (invalid type) or RangeError (invalid format/value).

const UNIT_SECONDS = { h: 3600, m: 60, s: 1 };
const UNIT_ORDER = { h: 0, m: 1, s: 2 };

// One segment: digits (no sign, no decimal, no exponent) followed by a single unit letter.
const SEGMENT = /(\d+)([hms])/g;

export function parseDuration(s) {
  if (typeof s !== "string") {
    throw new TypeError(`parseDuration: expected a string, got ${typeof s}`);
  }
  if (s.length === 0) {
    throw new RangeError("parseDuration: empty string");
  }

  let total = 0;
  let lastIndex = 0;
  let matched = false;
  let prevRank = -1;
  const seen = new Set();

  SEGMENT.lastIndex = 0;
  let m;
  while ((m = SEGMENT.exec(s)) !== null) {
    // No gap between segments — the whole string must be consumed contiguously.
    if (m.index !== lastIndex) {
      throw new RangeError(`parseDuration: unexpected characters in "${s}"`);
    }
    lastIndex = SEGMENT.lastIndex;
    matched = true;

    const unit = m[2];
    if (seen.has(unit)) {
      throw new RangeError(`parseDuration: duplicate unit "${unit}" in "${s}"`);
    }
    const rank = UNIT_ORDER[unit];
    if (rank <= prevRank) {
      throw new RangeError(`parseDuration: units out of order in "${s}"`);
    }
    prevRank = rank;
    seen.add(unit);

    const count = Number(m[1]);
    if (!Number.isSafeInteger(count)) {
      throw new RangeError(`parseDuration: count "${m[1]}" out of safe range in "${s}"`);
    }

    total += count * UNIT_SECONDS[unit];
  }

  if (!matched || lastIndex !== s.length) {
    throw new RangeError(`parseDuration: invalid duration "${s}"`);
  }

  return total;
}
