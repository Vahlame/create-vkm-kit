export function parseRange(s) {
  if (!s || typeof s !== 'string' || !s.trim()) {
    throw new Error('Input cannot be empty or whitespace-only');
  }

  const tokens = s.split(',');
  const result = new Set();

  for (const token of tokens) {
    const trimmedToken = token.trim();

    if (!trimmedToken) {
      throw new Error('Empty token');
    }

    const parts = trimmedToken.split('-');

    if (parts.length === 2) {
      const startStr = parts[0].trim();
      const endStr = parts[1].trim();

      if (!startStr || !endStr || !/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
        throw new Error('Malformed range');
      }

      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (start > end) {
        throw new Error('Reversed range');
      }

      for (let i = start; i <= end; i++) {
        result.add(i);
      }
    } else if (parts.length === 1) {
      const numStr = parts[0].trim();

      if (!/^\d+$/.test(numStr)) {
        throw new Error('Non-numeric or malformed value');
      }

      result.add(parseInt(numStr, 10));
    } else {
      throw new Error('Malformed token');
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
