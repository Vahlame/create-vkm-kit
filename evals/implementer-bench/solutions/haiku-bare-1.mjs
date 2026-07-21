export function parseRange(s) {
  // Check for empty or whitespace-only input
  if (!s || s.trim() === '') {
    throw new Error('Empty or whitespace-only input');
  }

  const tokens = s.split(',');
  const result = new Set();

  for (const token of tokens) {
    const trimmed = token.trim();

    // Check for empty token
    if (trimmed === '') {
      throw new Error('Empty token');
    }

    // Try to match as a range or single number
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);

    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10);
      const b = parseInt(rangeMatch[2], 10);

      // Check for reversed range
      if (a > b) {
        throw new Error('Reversed range');
      }

      // Add all numbers in the range
      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      // Try to match as a single number
      const numMatch = trimmed.match(/^(\d+)$/);

      if (numMatch) {
        const num = parseInt(numMatch[1], 10);
        result.add(num);
      } else {
        // Invalid format
        throw new Error('Malformed token');
      }
    }
  }

  // Return sorted array
  return Array.from(result).sort((a, b) => a - b);
}
