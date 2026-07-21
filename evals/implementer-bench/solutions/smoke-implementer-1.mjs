// Reference correct solution — the grader must score this 100.
export function parseRange(s) {
  if (typeof s !== "string" || s.trim() === "") throw new Error("empty input");
  const out = new Set();
  for (const rawTok of s.split(",")) {
    const tok = rawTok.trim();
    if (tok === "") throw new Error("empty token");
    const parts = tok.split("-");
    if (parts.length === 1) {
      out.add(toInt(parts[0]));
    } else if (parts.length === 2) {
      const a = toInt(parts[0]);
      const b = toInt(parts[1]);
      if (a > b) throw new Error("reversed range");
      for (let i = a; i <= b; i++) out.add(i);
    } else {
      throw new Error("malformed token");
    }
  }
  return [...out].sort((x, y) => x - y);
}
function toInt(str) {
  const t = str.trim();
  if (!/^\d+$/.test(t)) throw new Error("not a non-negative integer: " + JSON.stringify(str));
  return Number(t);
}
