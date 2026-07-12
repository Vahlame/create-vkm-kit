export function parseRange(s) {
  if (typeof s !== "string") {
    throw new TypeError(`parseRange: expected a string, got ${s === null ? "null" : typeof s}`);
  }

  if (s.trim() === "") return [];

  const TOKEN = /^(-?\d+)(?:-(-?\d+))?$/;

  const out = new Set();

  for (const raw of s.split(",")) {
    const token = raw.trim();
    if (token === "") {
      throw new Error(`parseRange: empty token in ${JSON.stringify(s)} (stray or trailing comma)`);
    }

    const m = TOKEN.exec(token);
    if (m === null) {
      throw new Error(`parseRange: malformed token ${JSON.stringify(token)}`);
    }

    const start = Number(m[1]);
    const end = m[2] === undefined ? start : Number(m[2]);

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      throw new Error(`parseRange: integer out of safe range in token ${JSON.stringify(token)}`);
    }
    if (start > end) {
      throw new Error(
        `parseRange: reversed range ${JSON.stringify(token)} (start ${start} > end ${end})`
      );
    }

    for (let n = start; n <= end; n++) out.add(n);
  }

  return [...out].sort((a, b) => a - b);
}
