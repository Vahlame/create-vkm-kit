export function parseRange(s) {
  if (typeof s !== "string") {
    throw new Error("Input must be a string");
  }

  const tokens = s.split(",").map((t) => t.trim());
  const result = [];

  for (const token of tokens) {
    if (!token) {
      throw new Error("Empty token in range string");
    }

    const rangeMatch = token.match(/^(\d+)-(\d+)$/);

    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);

      if (start > end) {
        throw new Error(`Invalid range: start ${start} is greater than end ${end}`);
      }

      for (let i = start; i <= end; i++) {
        result.push(i);
      }
    } else if (/^\d+$/.test(token)) {
      result.push(parseInt(token, 10));
    } else {
      throw new Error(`Invalid token: ${token}`);
    }
  }

  return result;
}
