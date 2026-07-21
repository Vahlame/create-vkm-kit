export function parseDuration(s) {
  let total = 0;
  const pattern = /(\d+)([hms])/g;
  let match;

  while ((match = pattern.exec(s)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (unit === 'h') {
      total += value * 3600;
    } else if (unit === 'm') {
      total += value * 60;
    } else if (unit === 's') {
      total += value;
    }
  }

  return total;
}
