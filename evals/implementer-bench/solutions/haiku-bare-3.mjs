export function parseRange(s) {
  if (!s || s.trim() === '') {
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
      const parts = trimmed.split('-');

      if (parts.length !== 2) {
        throw new Error('Malformed token');
      }

      const aStr = parts[0].trim();
      const bStr = parts[1].trim();

      if (aStr === '' || bStr === '') {
        throw new Error('Malformed token');
      }

      const a = Number(aStr);
      const b = Number(bStr);

      if (!Number.isInteger(a) || !Number.isSafeInteger(a) || aStr !== a.toString()) {
        throw new Error('Non-numeric or non-integer value');
      }
      if (!Number.isInteger(b) || !Number.isSafeInteger(b) || bStr !== b.toString()) {
        throw new Error('Non-numeric or non-integer value');
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

      if (!Number.isInteger(num) || !Number.isSafeInteger(num) || trimmed !== num.toString()) {
        throw new Error('Non-numeric or non-integer value');
      }

      if (num < 0) {
        throw new Error('Negative number');
      }

      result.add(num);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
