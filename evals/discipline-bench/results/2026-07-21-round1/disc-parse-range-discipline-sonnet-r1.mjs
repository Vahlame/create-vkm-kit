export function parseRange(s) {
  if (typeof s !== 'string') {
    throw new Error('parseRange: input must be a string');
  }

  const trimmed = s.trim();
  if (trimmed.length === 0) {
    throw new Error('parseRange: input is empty or whitespace-only');
  }

  const INT_RE = /^\d+$/;
  const result = new Set();

  for (const rawToken of trimmed.split(',')) {
    const token = rawToken.trim();
    if (token.length === 0) {
      throw new Error('parseRange: empty token');
    }

    if (token.includes('-')) {
      const parts = token.split('-');
      if (parts.length !== 2) {
        throw new Error(`parseRange: malformed token "${token}"`);
      }

      const [aStr, bStr] = parts.map((p) => p.trim());
      if (!INT_RE.test(aStr) || !INT_RE.test(bStr)) {
        throw new Error(`parseRange: malformed token "${token}"`);
      }

      const a = Number(aStr);
      const b = Number(bStr);
      if (a > b) {
        throw new Error(`parseRange: reversed range "${token}"`);
      }

      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      if (!INT_RE.test(token)) {
        throw new Error(`parseRange: malformed token "${token}"`);
      }
      result.add(Number(token));
    }
  }

  return Array.from(result).sort((x, y) => x - y);
}
