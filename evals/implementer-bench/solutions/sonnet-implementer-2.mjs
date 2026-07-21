export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') throw new Error('Invalid range string');
  const result = new Set();
  for (const raw of s.split(',')) {
    const token = raw.trim();
    if (token === '') throw new Error(`Invalid empty token in "${s}"`);
    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      if (a > b) throw new Error(`Reversed range: "${token}"`);
      for (let i = a; i <= b; i++) result.add(i);
    } else if (/^\d+$/.test(token)) {
      result.add(Number(token));
    } else {
      throw new Error(`Malformed token: "${token}"`);
    }
  }
  return [...result].sort((a, b) => a - b);
}
