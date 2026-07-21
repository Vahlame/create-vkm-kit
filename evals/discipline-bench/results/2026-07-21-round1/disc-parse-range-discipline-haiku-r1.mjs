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

    // Look for dash separator (not at position 0, which would indicate negative)
    const dashPos = trimmed.indexOf('-', 1);

    if (dashPos > 0) {
      // Parse as range A-B
      const aStr = trimmed.substring(0, dashPos).trim();
      const bStr = trimmed.substring(dashPos + 1).trim();

      if (!aStr || !bStr) {
        throw new Error('Malformed range');
      }

      const a = Number(aStr);
      const b = Number(bStr);

      if (!Number.isInteger(a) || a < 0) {
        throw new Error('Invalid range endpoint');
      }
      if (!Number.isInteger(b) || b < 0) {
        throw new Error('Invalid range endpoint');
      }
      if (a > b) {
        throw new Error('Reversed range');
      }

      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else if (trimmed[0] === '-') {
      // Starts with dash → negative number
      throw new Error('Negative number');
    } else {
      // Single number
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
