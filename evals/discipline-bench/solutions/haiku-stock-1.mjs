export function parseDuration(s) {
  let totalSeconds = 0;

  const matches = s.matchAll(/(\d+)([hms])/g);

  for (const match of matches) {
    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (unit === 'h') {
      totalSeconds += value * 3600;
    } else if (unit === 'm') {
      totalSeconds += value * 60;
    } else if (unit === 's') {
      totalSeconds += value;
    }
  }

  return totalSeconds;
}
