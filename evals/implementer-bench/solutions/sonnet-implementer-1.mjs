export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') throw new Error('Invalid input: empty');
  const out = new Set();
  for (const raw of s.split(',')) {
    const token = raw.trim();
    if (token === '') throw new Error('Invalid input: empty token');
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      if (a > b) throw new Error(`Invalid range: ${token}`);
      for (let i = a; i <= b; i++) out.add(i);
      continue;
    }
    const single = token.match(/^(\d+)$/);
    if (single) {
      out.add(parseInt(single[1], 10));
      continue;
    }
    throw new Error(`Invalid token: ${token}`);
  }
  return [...out].sort((x, y) => x - y);
}
