export function parseDuration(s) {
  if (!s || typeof s !== 'string') {
    return 0;
  }

  const unitMap = { h: 3600, m: 60, s: 1 };
  const matches = s.match(/(\d+)([hms])/g);

  if (!matches) {
    return 0;
  }

  let total = 0;
  for (const match of matches) {
    const num = parseInt(match.slice(0, -1), 10);
    const unit = match[match.length - 1];

    if (unit in unitMap) {
      total += num * unitMap[unit];
    }
  }

  return total;
}
