export function parseRange(s) {
  if (!s || typeof s !== "string" || s.trim() === "") {
    throw new Error("Input must be a non-empty string");
  }

  const tokens = s.split(",");
  const result = new Set();

  for (const token of tokens) {
    const trimmed = token.trim();

    if (trimmed === "") {
      throw new Error("Empty token");
    }

    if (trimmed.includes("-")) {
      const parts = trimmed.split("-");

      if (parts.length !== 2) {
        throw new Error(`Malformed token: ${trimmed}`);
      }

      const aPart = parts[0].trim();
      const bPart = parts[1].trim();

      if (!aPart || !/^\d+$/.test(aPart)) {
        throw new Error(`Invalid range start: ${aPart || "(empty)"}`);
      }
      const a = parseInt(aPart, 10);

      if (!bPart || !/^\d+$/.test(bPart)) {
        throw new Error(`Invalid range end: ${bPart || "(empty)"}`);
      }
      const b = parseInt(bPart, 10);

      if (a > b) {
        throw new Error(`Reversed range: ${a}-${b}`);
      }

      for (let i = a; i <= b; i++) {
        result.add(i);
      }
    } else {
      if (!/^\d+$/.test(trimmed)) {
        throw new Error(`Invalid token: ${trimmed}`);
      }
      const num = parseInt(trimmed, 10);
      result.add(num);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
