export function parseRange(s) {
  if (typeof s !== 'string' || s.trim().length === 0) {
    throw new Error('parseRange: input must be a non-empty string');
  }

  const numberPattern = /^\d+$/;
  const rangePattern = /^(\d+)\s*-\s*(\d+)$/;

  const tokens = s.split(',');
  const result = new Set();

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token.length === 0) {
      throw new Error('parseRange: empty token');
    }

    const rangeMatch = token.match(rangePattern);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0) {
        throw new Error(`parseRange: invalid numeric value in token "${token}"`);
      }
      if (start > end) {
        throw new Error(`parseRange: reversed range "${token}" (A > B)`);
      }
      for (let i = start; i <= end; i++) {
        result.add(i);
      }
      continue;
    }

    if (numberPattern.test(token)) {
      const value = Number(token);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`parseRange: invalid numeric value "${token}"`);
      }
      result.add(value);
      continue;
    }

    throw new Error(`parseRange: malformed token "${token}"`);
  }

  return Array.from(result).sort((a, b) => a - b);
}
