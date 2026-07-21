export function parseRange(s) {
  if (!s || s.trim() === '') {
    throw new Error('Input cannot be empty or whitespace-only');
  }

  const tokens = s.split(',');
  const result = new Set();

  for (const token of tokens) {
    const trimmed = token.trim();

    if (trimmed === '') {
      throw new Error('Empty token in input');
    }

    if (trimmed.includes('-')) {
      const parts = trimmed.split('-');

      if (parts.length !== 2) {
        throw new Error('Malformed range token');
      }

      const aStr = parts[0].trim();
      const bStr = parts[1].trim();

      if (aStr === '' || bStr === '') {
        throw new Error('Malformed range token');
      }

      const a = Number(aStr);
      const b = Number(bStr);

      if (!Number.isInteger(a) || a < 0 || !Number.isInteger(b) || b < 0) {
        throw new Error('Range bounds must be non-negative integers');
      }

      if (a > b) {
        throw new Error('Range is reversed (A > B)');
      }

      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      const num = Number(trimmed);

      if (!Number.isInteger(num) || num < 0) {
        throw new Error('Token must be a non-negative integer');
      }

      result.add(num);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
