export function parseRange(s) {
  // Check for empty or whitespace-only input
  if (!s || typeof s !== 'string' || s.trim() === '') {
    throw new Error('Input cannot be empty or whitespace-only');
  }

  const result = new Set();
  const tokens = s.split(',');

  const isValidInteger = (str) => {
    const trimmed = str.trim();
    if (trimmed === '') {
      return false; // Empty
    }
    if (/^-/.test(trimmed)) {
      return false; // Negative
    }
    if (!/^\d+$/.test(trimmed)) {
      return false; // Not all digits
    }
    return true;
  };

  for (const token of tokens) {
    const trimmed = token.trim();

    // Check for empty token
    if (trimmed === '') {
      throw new Error('Empty token found');
    }

    // Check if it's a range
    if (trimmed.includes('-')) {
      // Handle range: A-B
      const parts = trimmed.split('-');

      if (parts.length !== 2) {
        throw new Error('Malformed range token');
      }

      const aStr = parts[0].trim();
      const bStr = parts[1].trim();

      if (!isValidInteger(aStr) || !isValidInteger(bStr)) {
        throw new Error('Malformed range token');
      }

      const a = parseInt(aStr, 10);
      const b = parseInt(bStr, 10);

      // Check for reversed range
      if (a > b) {
        throw new Error('Reversed range (A > B)');
      }

      // Add all numbers in the range
      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      // Single number
      if (!isValidInteger(trimmed)) {
        throw new Error('Non-numeric or non-integer value');
      }

      const num = parseInt(trimmed, 10);
      result.add(num);
    }
  }

  // Convert to sorted array
  return Array.from(result).sort((a, b) => a - b);
}
