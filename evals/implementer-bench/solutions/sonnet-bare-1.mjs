export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('Invalid input: empty or whitespace-only input');
  }

  const tokens = s.split(',');
  const result = new Set();

  const parseInt10 = (str) => {
    const trimmed = str.trim();
    if (trimmed === '' || !/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid number: "${str}"`);
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Invalid number: "${str}"`);
    }
    return n;
  };

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token === '') {
      throw new Error('Invalid token: empty token');
    }

    if (token.includes('-')) {
      const parts = token.split('-');
      if (parts.length !== 2) {
        throw new Error(`Malformed token: "${token}"`);
      }
      const [aStr, bStr] = parts;
      const a = parseInt10(aStr);
      const b = parseInt10(bStr);
      if (a > b) {
        throw new Error(`Reversed range: "${token}"`);
      }
      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      const n = parseInt10(token);
      result.add(n);
    }
  }

  return Array.from(result).sort((x, y) => x - y);
}
