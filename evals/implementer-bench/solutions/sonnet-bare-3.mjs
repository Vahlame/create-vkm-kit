export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('Invalid input: empty or whitespace-only input');
  }

  const tokens = s.split(',');
  const result = new Set();

  const parseInteger = (str) => {
    const trimmed = str.trim();
    if (trimmed === '') {
      throw new Error('Invalid input: empty number');
    }
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid input: non-numeric or non-integer value "${trimmed}"`);
    }
    const num = Number(trimmed);
    if (!Number.isInteger(num) || num < 0) {
      throw new Error(`Invalid input: negative number or non-integer "${trimmed}"`);
    }
    return num;
  };

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token === '') {
      throw new Error('Invalid input: empty token');
    }

    if (token.includes('-')) {
      const parts = token.split('-');
      if (parts.length !== 2) {
        throw new Error(`Invalid input: malformed token "${token}"`);
      }
      const [aStr, bStr] = parts;
      const a = parseInteger(aStr);
      const b = parseInteger(bStr);
      if (a > b) {
        throw new Error(`Invalid input: reversed range "${token}"`);
      }
      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      const value = parseInteger(token);
      result.add(value);
    }
  }

  return Array.from(result).sort((x, y) => x - y);
}
