export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('invalid input');
  }
  const result = new Set();
  for (const rawToken of s.split(',')) {
    const token = rawToken.trim();
    if (token === '') {
      throw new Error('empty token');
    }
    if (token.includes('-')) {
      const parts = token.split('-');
      if (parts.length !== 2) {
        throw new Error('malformed token');
      }
      const a = parseNonNegativeInt(parts[0]);
      const b = parseNonNegativeInt(parts[1]);
      if (a > b) {
        throw new Error('reversed range');
      }
      for (let i = a; i <= b; i++) result.add(i);
    } else {
      result.add(parseNonNegativeInt(token));
    }
  }
  return [...result].sort((x, y) => x - y);
}

function parseNonNegativeInt(t) {
  const n = t.trim();
  if (!/^\d+$/.test(n)) {
    throw new Error('non-numeric, non-integer, or negative value');
  }
  return Number(n);
}
