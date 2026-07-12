export function parseRange(s) {
  if (typeof s !== "string") throw new TypeError("Input must be a string");
  if (s.trim() === "") return [];
  const result = new Set();
  for (const token of s.split(",")) {
    const trimmed = token.trim();
    if (trimmed === "") throw new Error("Empty token in range string");
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start > end) throw new Error(`Invalid range: ${start} > ${end}`);
      for (let i = start; i <= end; i++) result.add(i);
    } else {
      const singleMatch = trimmed.match(/^(\d+)$/);
      if (!singleMatch) throw new Error(`Invalid token: "${trimmed}"`);
      result.add(parseInt(singleMatch[1], 10));
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}
