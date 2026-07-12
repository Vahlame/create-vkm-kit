Implement `parseRange(s)` in modern JavaScript (ESM).

It turns a compact string like `"1-5,8,11-13"` into an array of the integers it denotes, where a
token is either a single integer or an inclusive range `A-B`.

Example: `"1-5,8,11-13"` → `[1,2,3,4,5,8,11,12,13]`.

Return ONLY the solution as a single ```js code block that exports the function
(`export function parseRange(s) { … }`). No explanation, no tests, no extra prose. Do not use any tools.

<!-- Under-specified on purpose: the invalid-input handling, sorting, uniqueness and whitespace
rules are NOT spelled out. The hidden grader still checks them — a subject only passes by INFERRING
the implicit requirements (which is exactly what "deliver more than asked / validate boundaries"
should produce). Paired with PROMPT.md (fully explicit) to separate the visible-contract case
(saturates) from the not-visible case (where discipline shows its value). -->
