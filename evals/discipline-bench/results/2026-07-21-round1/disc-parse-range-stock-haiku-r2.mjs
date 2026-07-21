export function parseRange(s) {
  if (!s || !s.trim()) {
    throw new Error("Empty or whitespace-only input");
  }

  const result = new Set();
  const tokens = s.split(',');

  for (const token of tokens) {
    const trimmed = token.trim();

    if (!trimmed) {
      throw new Error("Empty token");
    }

    if (trimmed.includes('-')) {
      const parts = trimmed.split('-');

      if (parts.length !== 2) {
        throw new Error("Malformed range");
      }

      const aStr = parts[0].trim();
      const bStr = parts[1].trim();

      if (!aStr || !bStr) {
        throw new Error("Malformed range");
      }

      if (!/^\d+$/.test(aStr) || !/^\d+$/.test(bStr)) {
        throw new Error("Malformed range");
      }

      const a = parseInt(aStr, 10);
      const b = parseInt(bStr, 10);

      if (a > b) {
        throw new Error("Reversed range");
      }

      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      if (!/^\d+$/.test(trimmed)) {
        throw new Error("Malformed number");
      }

      const num = parseInt(trimmed, 10);
      result.add(num);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
