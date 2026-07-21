export function parseDuration(s) {
  const units = { h: 3600, m: 60, s: 1 };
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*([hms])/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    total += parseFloat(m[1]) * units[m[2].toLowerCase()];
  }
  return total;
}
