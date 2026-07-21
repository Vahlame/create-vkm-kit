export function parseRange(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('Invalid input: empty or whitespace-only');
  }

  const tokens = s.split(',');
  const result = new Set();

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token === '') {
      throw new Error(`Invalid input: empty token`);
    }

    if (token.includes('-')) {
      const parts = token.split('-');
      if (parts.length !== 2) {
        throw new Error(`Invalid input: malformed token "${token}"`);
      }
      const [aRaw, bRaw] = parts;
      const a = aRaw.trim();
      const b = bRaw.trim();
      if (a === '' || b === '') {
        throw new Error(`Invalid input: malformed token "${token}"`);
      }
      const aNum = parseIntegerStrict(a, token);
      const bNum = parseIntegerStrict(b, token);
      if (aNum > bNum) {
        throw new Error(`Invalid input: reversed range "${token}"`);
      }
      for (let i = aNum; i <= bNum; i++) {
        result.add(i);
      }
    } else {
      const num = parseIntegerStrict(token, token);
      result.add(num);
    }
  }

  return Array.from(result).sort((x, y) => x - y);
}

function parseIntegerStrict(value, token) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid input: non-numeric or non-integer value in token "${token}"`);
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new Error(`Invalid input: negative or non-integer value in token "${token}"`);
  }
  return num;
}
