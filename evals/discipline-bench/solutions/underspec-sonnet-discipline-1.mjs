export function parseRange(s) {
  if (typeof s !== "string") {
    throw new Error(`parseRange: expected a string, got ${typeof s}`);
  }

  const trimmed = s.trim();
  if (trimmed === "") {
    throw new Error("parseRange: input is empty");
  }

  const INT_RE = /^-?\d+$/;
  const result = new Set();

  const tokens = trimmed.split(",").map((t) => t.trim());

  for (const token of tokens) {
    if (token === "") {
      throw new Error(`parseRange: empty token in "${s}"`);
    }

    if (token.includes("-") && token.lastIndexOf("-") > 0) {
      const dashIdx = token.indexOf("-");
      const left = token.slice(0, dashIdx);
      const right = token.slice(dashIdx + 1);

      if (!INT_RE.test(left) || !INT_RE.test(right)) {
        throw new Error(`parseRange: invalid range token "${token}" in "${s}"`);
      }

      const start = Number(left);
      const end = Number(right);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        throw new Error(`parseRange: integer out of safe range in token "${token}"`);
      }
      if (start > end) {
        throw new Error(`parseRange: range start greater than end in token "${token}"`);
      }

      for (let i = start; i <= end; i++) {
        result.add(i);
      }
    } else {
      if (!INT_RE.test(token)) {
        throw new Error(`parseRange: invalid token "${token}" in "${s}"`);
      }
      const value = Number(token);
      if (!Number.isSafeInteger(value)) {
        throw new Error(`parseRange: integer out of safe range in token "${token}"`);
      }
      result.add(value);
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
