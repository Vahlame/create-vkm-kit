export function parseRange(s) {
  if (typeof s !== "string") {
    throw new Error("Input must be a string");
  }

  const trimmed = s.trim();
  if (!trimmed) {
    throw new Error("Input must not be empty or whitespace-only");
  }

  const tokens = trimmed.split(",");
  const result = [];

  for (const token of tokens) {
    const t = token.trim();

    if (!t) {
      throw new Error("Empty token in range string");
    }

    const rangeMatch = t.match(/^(-?\d+)-(-?\d+)$/);

    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);

      if (start > end) {
        throw new Error(`Invalid range: start (${start}) must be <= end (${end})`);
      }

      for (let i = start; i <= end; i++) {
        result.push(i);
      }
    } else {
      if (!t.match(/^-?\d+$/)) {
        throw new Error(`Invalid integer: "${t}"`);
      }

      const num = parseInt(t, 10);
      result.push(num);
    }
  }

  return [...new Set(result)].sort((a, b) => a - b);
}
