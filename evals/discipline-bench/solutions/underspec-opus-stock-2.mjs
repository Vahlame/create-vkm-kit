export function parseRange(s) {
  return s.split(",").flatMap((token) => {
    const trimmed = token.trim();
    if (trimmed === "") return [];
    const parts = trimmed.split("-");
    if (parts.length === 1) {
      return [Number(parts[0])];
    }
    const start = Number(parts[0]);
    const end = Number(parts[1]);
    const step = start <= end ? 1 : -1;
    const out = [];
    for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
      out.push(i);
    }
    return out;
  });
}
