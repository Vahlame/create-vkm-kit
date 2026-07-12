export function parseRange(s) {
  return s.split(",").flatMap((token) => {
    if (token.includes("-")) {
      const [start, end] = token.split("-").map(Number);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return [Number(token)];
  });
}
