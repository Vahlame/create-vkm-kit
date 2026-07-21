export function parseRange(s) {
  if (!s || typeof s !== 'string' || s.trim() === '') {
    throw new Error('Empty or whitespace-only input');
  }

  const tokens = s.split(',');
  const result = new Set();

  for (const token of tokens) {
    const trimmed = token.trim();

    if (trimmed === '') {
      throw new Error('Empty token');
    }

    if (trimmed.includes('-')) {
      const dashIndex = trimmed.indexOf('-');
      const aPart = trimmed.substring(0, dashIndex).trim();
      const bPart = trimmed.substring(dashIndex + 1).trim();

      if (aPart === '' || bPart === '') {
        throw new Error('Malformed token');
      }

      const a = Number(aPart);
      const b = Number(bPart);

      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new Error('Non-integer value');
      }

      if (a < 0 || b < 0) {
        throw new Error('Negative number');
      }

      if (a > b) {
        throw new Error('Reversed range');
      }

      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      const num = Number(trimmed);

      if (!Number.isInteger(num)) {
        throw new Error('Non-integer value');
      }

      if (num < 0) {
        throw new Error('Negative number');
      }

      result.add(num);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
