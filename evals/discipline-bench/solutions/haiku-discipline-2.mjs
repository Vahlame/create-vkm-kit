export function parseDuration(s) {
  if (!s || typeof s !== 'string') return 0;

  let total = 0;
  const regex = /(\d+)([hms])/g;
  let match;

  while ((match = regex.exec(s)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'h':
        total += value * 3600;
        break;
      case 'm':
        total += value * 60;
        break;
      case 's':
        total += value;
        break;
    }
  }

  return total;
}

// Evidence: test the requirement
console.assert(parseDuration("1h30m") === 5400, "1h30m should equal 5400");
console.assert(parseDuration("1h") === 3600, "1h should equal 3600");
console.assert(parseDuration("30m") === 1800, "30m should equal 1800");
console.assert(parseDuration("45s") === 45, "45s should equal 45");
console.assert(parseDuration("1h30m45s") === 5445, "1h30m45s should equal 5445");
