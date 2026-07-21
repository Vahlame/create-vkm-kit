export function parseRange(s) {
  if (!s || !s.trim()) {
    throw new Error("Empty input");
  }

  const tokens = s.split(',');
  const numbers = new Set();

  for (const token of tokens) {
    const trimmed = token.trim();

    if (!trimmed) {
      throw new Error("Empty token");
    }

    if (trimmed.includes('-')) {
      const parts = trimmed.split('-');

      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error("Malformed range");
      }

      const [aStr, bStr] = parts;

      if (!/^\d+$/.test(aStr) || !/^\d+$/.test(bStr)) {
        throw new Error("Invalid range format");
      }

      const a = Number(aStr);
      const b = Number(bStr);

      if (a > b) {
        throw new Error("Reversed range");
      }

      for (let i = a; i <= b; i++) {
        numbers.add(i);
      }
    } else {
      if (!/^\d+$/.test(trimmed)) {
        throw new Error("Invalid number format");
      }

      const num = Number(trimmed);
      numbers.add(num);
    }
  }

  return Array.from(numbers).sort((a, b) => a - b);
}
