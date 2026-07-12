export function parseRange(s) {
  if (typeof s !== "string") {
    throw new Error(`parseRange: expected a string, got ${typeof s}`);
  }
  if (s.trim() === "") {
    throw new Error("parseRange: input is empty or whitespace-only");
  }

  const INT = /^\d+$/;
  const result = new Set();

  for (const rawToken of s.split(",")) {
    const token = rawToken.trim();
    if (token === "") {
      throw new Error(`parseRange: empty token in "${s}"`);
    }

    const parts = token.split("-");
    if (parts.length === 1) {
      const numStr = parts[0].trim();
      if (!INT.test(numStr)) {
        throw new Error(`parseRange: malformed integer token "${token}"`);
      }
      result.add(Number(numStr));
    } else if (parts.length === 2) {
      const aStr = parts[0].trim();
      const bStr = parts[1].trim();
      if (!INT.test(aStr) || !INT.test(bStr)) {
        throw new Error(`parseRange: malformed range token "${token}"`);
      }
      const a = Number(aStr);
      const b = Number(bStr);
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
        throw new Error(`parseRange: value out of safe integer range in "${token}"`);
      }
      if (a > b) {
        throw new Error(`parseRange: reversed range "${token}" (${a} > ${b})`);
      }
      for (let n = a; n <= b; n++) {
        result.add(n);
      }
    } else {
      throw new Error(`parseRange: malformed token "${token}"`);
    }
  }

  return [...result].sort((x, y) => x - y);
}
