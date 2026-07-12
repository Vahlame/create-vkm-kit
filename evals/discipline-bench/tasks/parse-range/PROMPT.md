Implement `parseRange(s)` in modern JavaScript (ESM).

It parses a compact integer-set string into a sorted array of unique integers.

- The string is a comma-separated list of tokens. Each token is either a single non-negative integer
  (e.g. `8`) or an inclusive range `A-B` where A and B are non-negative integers with A ≤ B.
- Whitespace around tokens and numbers is ignored.
- Return the integers as an array, sorted ascending, with duplicates removed.
  Example: `"1-5,8,11-13"` → `[1,2,3,4,5,8,11,12,13]`.
- On any invalid input, `throw` an Error. Invalid includes: empty or whitespace-only input, an empty
  token, a reversed range (A > B), a malformed token, a non-numeric or non-integer value, and a
  negative number.

Return ONLY the solution as a single ```js code block that exports the function
(`export function parseRange(s) { … }`). No explanation, no tests, no extra prose. Do not use tools.
