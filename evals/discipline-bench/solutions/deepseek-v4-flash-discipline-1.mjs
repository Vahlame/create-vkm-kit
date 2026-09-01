export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('invalid range input');
  }
  const out = [];
  for (const raw of s.split(',')) {
    const token = raw.replace(/\s+/g, '');
    if (token === '') {
      throw new Error('empty token');
    }
    const m = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!m) {
      throw new Error('malformed token: ' + token);
    }
    const a = Number(m[1]);
    if (m[2] === undefined) {
      out.push(a);
    } else {
      const b = Number(m[2]);
      if (a > b) {
        throw new Error('reversed range');
      }
      for (let i = a; i <= b; i++) {
        out.push(i);
      }
    }
  }
  return [...new Set(out)].sort((x, y) => x - y);
}
