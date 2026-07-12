export function parseRange(s) {
  if (!s || s.trim() === "") return [];
  const result = [];
  for (const token of s.split(",")) {
    const trimmed = token.trim();
    if (trimmed === "") throw new Error("Invalid token: empty");
    if (trimmed.includes("-")) {
      const parts = trimmed.split("-");
      if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim())
        throw new Error(`Invalid range format: "${trimmed}"`);
      const start = parseInt(parts[0].trim(), 10);
      const end = parseInt(parts[1].trim(), 10);
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid range format: "${trimmed}"`);
      if (start < 0 || end < 0) throw new Error(`Range values must be non-negative: "${trimmed}"`);
      if (start > end) throw new Error(`Invalid range: start (${start}) > end (${end})`);
      for (let i = start; i <= end; i++) result.push(i);
    } else {
      const value = parseInt(trimmed, 10);
      if (isNaN(value)) throw new Error(`Invalid integer: "${trimmed}"`);
      if (value < 0) throw new Error(`Value must be non-negative: ${value}`);
      result.push(value);
    }
  }
  return [...new Set(result)].sort((a, b) => a - b);
}
