export function parseRange(s) {
  if (typeof s !== "string") {
    throw new TypeError(`parseRange: expected a string, got ${typeof s}`);
  }

  const trimmed = s.trim();
  if (trimmed === "") {
    throw new Error("parseRange: input is empty");
  }

  const result = new Set();

  for (const rawToken of trimmed.split(",")) {
    const token = rawToken.trim();
    if (token === "") {
      throw new Error("parseRange: empty token (check for stray or trailing commas)");
    }

    const rangeMatch = token.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        throw new Error(`parseRange: range bound out of safe integer domain in "${token}"`);
      }
      const [lo, hi] = start <= end ? [start, end] : [end, start];
      for (let n = lo; n <= hi; n++) result.add(n);
      continue;
    }

    const singleMatch = token.match(/^-?\d+$/);
    if (singleMatch) {
      const n = Number(token);
      if (!Number.isSafeInteger(n)) {
        throw new Error(`parseRange: value out of safe integer domain in "${token}"`);
      }
      result.add(n);
      continue;
    }

    throw new Error(`parseRange: invalid token "${token}"`);
  }

  return [...result].sort((a, b) => a - b);
}
