export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') throw new Error('Invalid input: empty');

  const toInt = (str) => {
    const t = str.trim();
    if (!/^\d+$/.test(t)) throw new Error(`Invalid number: "${str}"`);
    return Number(t);
  };

  const result = new Set();
  for (const rawToken of s.split(',')) {
    const token = rawToken.trim();
    if (token === '') throw new Error('Invalid input: empty token');

    if (token.includes('-')) {
      const parts = token.split('-');
      if (parts.length !== 2) throw new Error(`Malformed range token: "${token}"`);
      const a = toInt(parts[0]);
      const b = toInt(parts[1]);
      if (a > b) throw new Error(`Reversed range: "${token}"`);
      for (let i = a; i <= b; i++) result.add(i);
    } else {
      result.add(toInt(token));
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
