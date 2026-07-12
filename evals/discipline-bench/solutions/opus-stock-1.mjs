export function parseRange(s) {
  if (typeof s !== "string") throw new Error("Input must be a string");
  if (s.trim() === "") throw new Error("Empty or whitespace-only input");

  const result = new Set();

  for (const rawToken of s.split(",")) {
    const token = rawToken.trim();
    if (token === "") throw new Error(`Empty token in input: "${s}"`);

    const parts = token.split("-");

    if (parts.length === 1) {
      result.add(parseNonNegativeInt(parts[0], token));
    } else if (parts.length === 2) {
      const a = parseNonNegativeInt(parts[0], token);
      const b = parseNonNegativeInt(parts[1], token);
      if (a > b) throw new Error(`Reversed range (A > B): "${token}"`);
      for (let n = a; n <= b; n++) result.add(n);
    } else {
      throw new Error(`Malformed token: "${token}"`);
    }
  }

  return [...result].sort((x, y) => x - y);
}

function parseNonNegativeInt(raw, token) {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`Non-numeric, non-integer, or negative value in token: "${token}"`);
  }
  return Number(text);
}
