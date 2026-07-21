export function parseDuration(s) {
  let total = 0;
  const parts = String(s).match(/(\d+)([hms])/g) || [];
  for (const p of parts) {
    const v = parseInt(p);
    if (p.endsWith("h")) total += v * 3600;
    else if (p.endsWith("m")) total += v * 60;
    else total += v;
  }
  return total;
}
