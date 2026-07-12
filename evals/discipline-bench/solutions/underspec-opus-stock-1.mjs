export function parseRange(s) {
  return s.split(",").flatMap((token) => {
    const trimmed = token.trim();
    if (trimmed === "") return [];
    const parts = trimmed.split("-").map((p) => p.trim());
    if (parts.length === 2 && parts[0] !== "" && parts[1] !== "") {
      const start = Number(parts[0]);
      const end = Number(parts[1]);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new RangeError(`Invalid range token: "${trimmed}"`);
      }
      const step = start <= end ? 1 : -1;
      const out = [];
      for (let n = start; step > 0 ? n <= end : n >= end; n += step) {
        out.push(n);
      }
      return out;
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n)) {
      throw new RangeError(`Invalid token: "${trimmed}"`);
    }
    return [n];
  });
}
