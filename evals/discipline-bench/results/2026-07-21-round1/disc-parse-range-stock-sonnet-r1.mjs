export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('Invalid input: empty or whitespace-only string');
  }

  const tokens = s.split(',');
  const result = new Set();

  const parseInt10Strict = (str) => {
    const t = str.trim();
    if (t === '' || !/^\d+$/.test(t)) {
      throw new Error(`Invalid number: "${str}"`);
    }
    const n = Number(t);
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
        throw new Error(`Malformed range token: "${token}"`);
      }
      const [aStr, bStr] = parts;
      const a = parseInt10Strict(aStr);
      const b = parseInt10Strict(bStr);
      if (a > b) {
        throw new Error(`Invalid range (reversed): "${token}"`);
      }
      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      const n = parseInt10Strict(token);
      result.add(n);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
