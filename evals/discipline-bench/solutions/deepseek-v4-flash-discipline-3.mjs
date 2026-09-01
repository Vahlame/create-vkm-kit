export function parseRange(s) {
  if (typeof s !== 'string') throw new Error('parseRange: input must be a string');

  const trimmed = s.trim();
  if (trimmed === '') throw new Error('parseRange: input is empty');

  const result = [];
  const seen = new Set();

  for (const rawToken of trimmed.split(',')) {
    const token = rawToken.trim();
    if (token === '') throw new Error('parseRange: empty token');

    if (token.includes('-')) {
      if (token.indexOf('-') !== token.lastIndexOf('-')) {
        throw new Error(`parseRange: malformed token "${token}"`);
      }
      const [aRaw, bRaw] = token.split('-');
      const aStr = aRaw.trim();
      const bStr = bRaw.trim();
      if (aStr === '' || bStr === '') throw new Error(`parseRange: malformed token "${token}"`);
      const a = toNonNegativeInt(aStr, token);
      const b = toNonNegativeInt(bStr, token);
      if (a > b) throw new Error(`parseRange: reversed range "${token}"`);
      for (let i = a; i <= b; i++) {
        if (!seen.has(i)) {
          seen.add(i);
          result.push(i);
        }
      }
    } else {
      const n = toNonNegativeInt(token, token);
      if (!seen.has(n)) {
        seen.add(n);
        result.push(n);
      }
    }
  }

  return result.sort((x, y) => x - y);
}

function toNonNegativeInt(str, token) {
  if (!/^\d+$/.test(str)) throw new Error(`parseRange: invalid number in "${token}"`);
  const n = Number(str);
  if (!Number.isSafeInteger(n)) throw new Error(`parseRange: number out of safe integer range in "${token}"`);
  return n;
}
