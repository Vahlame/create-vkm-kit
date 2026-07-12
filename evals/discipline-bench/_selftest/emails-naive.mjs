// Reference naive solution for dedupe-emails — exact-dedup only, no normalize/validate.
// Grader must score this well below 100 (fails case/trim dedup and all invalid-throws cases).
export function dedupeEmails(list) {
  return [...new Set(list)];
}
