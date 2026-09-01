export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('invalid input');
  }
  const result = [];
  for (const rawToken of s.split(',')) {
    const token = rawToken.replace(/\s+/g, '');
    if (token === '') {
      throw new Error('empty token');
    }
    const m = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) {
      throw new Error('malformed token');
    }
    const a = Number(m[1]);
    if (m[2] === undefined) {
      result.push(a);
    } else {
      const b = Number(m[2]);
      if (a > b) {
        throw new Error('reversed range');
      }
      for (let i = a; i <= b; i++) {
        result.push(i);
      }
    }
  }
  return [...new Set(result)].sort((x, y) => x - y);
}
