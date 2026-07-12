export function parseRange(s) {
  return s.split(",").flatMap((token) => {
    const [start, end] = token.split("-").map(Number);
    if (end === undefined) {
      return start;
    }
    const result = [];
    for (let i = start; i <= end; i++) {
      result.push(i);
    }
    return result;
  });
}
