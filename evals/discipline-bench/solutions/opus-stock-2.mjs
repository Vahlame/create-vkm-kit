export function parseDuration(s) {
  if (typeof s !== "string") throw new TypeError("parseDuration expects a string");
  const multipliers = { h: 3600, m: 60, s: 1 };
  let total = 0;
  let matched = false;
  const re = /(\d+)([hms])/g;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index !== lastIndex) {
      throw new SyntaxError(`Invalid duration string: ${s}`);
    }
    total += Number(m[1]) * multipliers[m[2]];
    lastIndex = re.lastIndex;
    matched = true;
  }
  if (!matched || lastIndex !== s.length) {
    throw new SyntaxError(`Invalid duration string: ${s}`);
  }
  return total;
}
