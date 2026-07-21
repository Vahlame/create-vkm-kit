// Reference naive happy-path solution — the grader must score this well below 100
// (no validation, no dedup): it should fail the throw-cases and the overlap/dupe cases.
export function parseRange(s) {
  const out = [];
  for (const tok of s.split(",")) {
    if (tok.includes("-")) {
      const [a, b] = tok.split("-").map(Number);
      for (let i = a; i <= b; i++) out.push(i);
    } else {
      out.push(Number(tok));
    }
  }
  return out.sort((x, y) => x - y);
}
