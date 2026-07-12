export function parseRange(s) {
  const result = [];
  for (const token of s.split(",")) {
    const trimmed = token.trim();
    if (trimmed === "") continue;
    const match = trimmed.match(/^(-?\d+)-(-?\d+)$/);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      for (let i = start; i <= end; i++) result.push(i);
    } else {
      result.push(Number(trimmed));
    }
  }
  return result;
}
