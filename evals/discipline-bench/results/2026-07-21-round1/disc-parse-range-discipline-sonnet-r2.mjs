export function parseRange(s) {
  if (typeof s !== 'string') {
    throw new Error('Invalid input: expected a string');
  }

  const trimmed = s.trim();
  if (trimmed === '') {
    throw new Error('Invalid input: empty or whitespace-only string');
  }

  const INT_RE = /^\d+$/;

  const parseNonNegativeInt = (str, context) => {
    const t = str.trim();
    if (!INT_RE.test(t)) {
      throw new Error(`Invalid token "${context}": "${str.trim()}" is not a non-negative integer`);
    }
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Invalid token "${context}": "${str.trim()}" is not a non-negative integer`);
    }
    return n;
  };

  const values = new Set();
  const tokens = trimmed.split(',');

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token === '') {
      throw new Error('Invalid token: empty token');
    }

    const parts = token.split('-');

    if (parts.length === 1) {
      const n = parseNonNegativeInt(parts[0], token);
      values.add(n);
    } else if (parts.length === 2) {
      const a = parseNonNegativeInt(parts[0], token);
      const b = parseNonNegativeInt(parts[1], token);
      if (a > b) {
        throw new Error(`Invalid range "${token}": start ${a} is greater than end ${b}`);
      }
      for (let i = a; i <= b; i++) {
        values.add(i);
      }
    } else {
      throw new Error(`Malformed token: "${token}"`);
    }
  }

  return Array.from(values).sort((x, y) => x - y);
}
