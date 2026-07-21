export function mergeIntervals(list) {
  if (!Array.isArray(list)) throw new Error("not an array");
  const items = list.map((iv) => {
    if (!Array.isArray(iv) || iv.length !== 2 || !Number.isFinite(iv[0]) || !Number.isFinite(iv[1]))
      throw new Error("invalid interval");
    if (iv[0] > iv[1]) throw new Error("reversed interval");
    return [iv[0], iv[1]];
  });
  items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [s, e] of items) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
