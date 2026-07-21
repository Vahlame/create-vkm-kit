export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('Invalid input: empty or whitespace-only');
  }

  const tokens = s.split(',');
  const result = new Set();

  const parseInt10 = (raw, label) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      throw new Error(`Invalid token: empty ${label}`);
    }
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid ${label}: "${raw}" is not a non-negative integer`);
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Invalid ${label}: "${raw}" is not a non-negative integer`);
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
        throw new Error(`Malformed range token: "${rawToken}"`);
      }
      const [aRaw, bRaw] = parts;
      const a = parseInt10(aRaw, 'range start');
      const b = parseInt10(bRaw, 'range end');
      if (a > b) {
        throw new Error(`Invalid range: ${a} > ${b}`);
      }
      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      const n = parseInt10(token, 'value');
      result.add(n);
    }
  }

  return Array.from(result).sort((x, y) => x - y);
}
