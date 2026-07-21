export function dedupeEmails(list) {
  const seen = new Set();
  const result = [];

  for (const email of list) {
    const normalized = String(email).trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}
