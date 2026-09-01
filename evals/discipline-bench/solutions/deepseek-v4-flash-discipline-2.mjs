export function parseRange(s) {
  if (typeof s !== 'string') throw new Error('parseRange: input must be a string');
  const compact = s.replace(/\s+/g, '');
  if (compact === '') throw new Error('parseRange: empty input');
  const result = [];
  for (const rawToken of compact.split(',')) {
    if (rawToken === '') throw new Error('parseRange: empty token');
    const m = /^(\d+)(?:-(\d+))?$/.exec(rawToken);
    if (!m) throw new Error(`parseRange: malformed token "${rawToken}"`);
    const a = Number(m[1]);
    if (m[2] === undefined) {
      result.push(a);
    } else {
      const b = Number(m[2]);
      if (a > b) throw new Error(`parseRange: reversed range "${rawToken}"`);
      for (let i = a; i <= b; i++) result.push(i);
    }
  }
  return [...new Set(result)].sort((x, y) => x - y);
}
