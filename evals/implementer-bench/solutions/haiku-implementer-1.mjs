export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('Invalid input');
  }

  const tokens = s.split(',');
  const result = new Set();

  for (const token of tokens) {
    const trimmed = token.trim();

    if (trimmed === '') {
      throw new Error('Invalid input');
    }

    if (trimmed.includes('-')) {
      const parts = trimmed.split('-');

      if (parts.length !== 2) {
        throw new Error('Invalid input');
      }

      const aStr = parts[0].trim();
      const bStr = parts[1].trim();

      if (aStr === '' || bStr === '') {
        throw new Error('Invalid input');
      }

      if (!/^\d+$/.test(aStr) || !/^\d+$/.test(bStr)) {
        throw new Error('Invalid input');
      }

      const a = Number(aStr);
      const b = Number(bStr);

      if (a > b) {
        throw new Error('Invalid input');
      }

      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      if (!/^\d+$/.test(trimmed)) {
        throw new Error('Invalid input');
      }

      result.add(Number(trimmed));
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
