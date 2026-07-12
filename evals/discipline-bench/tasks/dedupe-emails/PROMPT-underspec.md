Implement `dedupeEmails(list)` in modern JavaScript (ESM).

Given an array of email address strings, return an array of the unique emails.

Example: `["a@x.com", "b@y.com"]` → `["a@x.com", "b@y.com"]`.

Return ONLY the solution as a single ```js code block that exports the function
(`export function dedupeEmails(list) { … }`). No explanation, no tests, no extra prose. Do not use any tools.

<!-- Under-specified on purpose: normalization (case, whitespace), what "unique" means across those, and
handling of invalid/empty entries are NOT stated. The hidden grader checks them — a subject only passes
by INFERRING that "unique emails" implies case-insensitive + trimmed dedup and that a garbage entry is a
typed error, not a silent pass. Paired with the coding parse-range task to test whether the discipline
generalizes across domains. -->
