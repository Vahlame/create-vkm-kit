export function parseDuration(s) {
  const units = { h: 3600, m: 60, s: 1 };
  const re = /(\d+(?:\.\d+)?)([hms])/g;
  let total = 0;
  let match;
  let matched = false;

  while ((match = re.exec(s)) !== null) {
    matched = true;
    const [, value, unit] = match;
    total += parseFloat(value) * units[unit];
  }

  if (!matched) {
    throw new Error(`Invalid duration string: "${s}"`);
  }

  return total;
}
