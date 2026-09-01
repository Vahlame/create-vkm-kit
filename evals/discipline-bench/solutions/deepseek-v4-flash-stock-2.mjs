export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('invalid input: empty or whitespace-only');
  }
  const out = new Set();
  for (const raw of s.split(',')) {
    const token = raw.trim();
    if (token === '') {
      throw new Error('invalid input: empty token');
    }
    const m = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!m) {
      throw new Error('invalid input: malformed token');
    }
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b < a) {
      throw new Error('invalid input: reversed range');
    }
    for (let i = a; i <= b; i++) {
      out.add(i);
    }
  }
  return [...out].sort((x, y) => x - y);
}
