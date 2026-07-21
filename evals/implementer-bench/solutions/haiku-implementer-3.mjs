export function parseRange(s) {
  if (!s || !s.trim()) {
    throw new Error('Empty or whitespace-only input');
  }

  const tokens = s.split(',');
  const result = new Set();

  for (const token of tokens) {
    const trimmed = token.trim();

    if (!trimmed) {
      throw new Error('Empty token');
    }

    if (trimmed.includes('-')) {
      const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!match) {
        throw new Error('Malformed token');
      }

      const a = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);

      if (a > b) {
        throw new Error('Reversed range');
      }

      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      if (!/^\d+$/.test(trimmed)) {
        throw new Error('Non-numeric or non-integer value');
      }

      const num = parseInt(trimmed, 10);
      result.add(num);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
