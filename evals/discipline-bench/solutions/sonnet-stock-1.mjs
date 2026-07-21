export function parseDuration(s) {
  const re = /(\d+)(h|m|s)/g;
  let total = 0;
  let match;
  let matched = false;
  const units = { h: 3600, m: 60, s: 1 };
  while ((match = re.exec(s)) !== null) {
    matched = true;
    total += Number(match[1]) * units[match[2]];
  }
  if (!matched) {
    throw new Error(`Invalid duration string: ${s}`);
  }
  return total;
}
