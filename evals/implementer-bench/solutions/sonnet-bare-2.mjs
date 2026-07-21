export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('Invalid input: empty or whitespace-only input');
  }

  const tokens = s.split(',');
  const result = new Set();

  const parseInteger = (str) => {
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
      throw new Error('Invalid input: empty token');
    }

    if (token.includes('-')) {
      const parts = token.split('-');
      if (parts.length !== 2) {
        throw new Error(`Malformed range token: "${rawToken}"`);
      }
      const a = parseInteger(parts[0]);
      const b = parseInteger(parts[1]);
      if (a > b) {
        throw new Error(`Reversed range: "${rawToken}"`);
      }
      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      const n = parseInteger(token);
      result.add(n);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
