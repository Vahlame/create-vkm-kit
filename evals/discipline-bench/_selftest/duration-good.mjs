export function parseDuration(s) {
  if (typeof s !== "string") throw new Error("not a string");
  const t = s.trim();
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || t === "") throw new Error("invalid duration");
  if (m[1] === undefined && m[2] === undefined && m[3] === undefined)
    throw new Error("no components");
  const h = m[1] ? Number(m[1]) : 0,
    min = m[2] ? Number(m[2]) : 0,
    sec = m[3] ? Number(m[3]) : 0;
  return h * 3600 + min * 60 + sec;
}
