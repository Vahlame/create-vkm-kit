export function parseRange(s) {
  if (!s || typeof s !== 'string' || s.trim().length === 0) {
    throw new Error('Invalid input: empty or whitespace-only string');
  }

  const tokens = s.split(',');
  const resultSet = new Set();

  for (const token of tokens) {
    const trimmed = token.trim();

    if (trimmed.length === 0) {
      throw new Error('Invalid input: empty token');
    }

    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);

    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10);
      const b = parseInt(rangeMatch[2], 10);

      if (a > b) {
        throw new Error(`Invalid input: reversed range (${a} > ${b})`);
      }

      for (let i = a; i <= b; i++) {
        resultSet.add(i);
      }
    } else {
      const numMatch = trimmed.match(/^(\d+)$/);

      if (!numMatch) {
        throw new Error(`Invalid input: malformed token "${trimmed}"`);
      }

      const num = parseInt(numMatch[1], 10);
      resultSet.add(num);
    }
  }

  return Array.from(resultSet).sort((a, b) => a - b);
}
