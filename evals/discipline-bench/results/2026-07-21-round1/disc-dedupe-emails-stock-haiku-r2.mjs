export function dedupeEmails(list) {
  const seen = new Set();
  const result = [];

  for (const email of list) {
    if (typeof email !== 'string') {
      continue;
    }

    const trimmed = email.trim();

    if (!trimmed || !trimmed.includes('@')) {
      continue;
    }

    const normalized = trimmed.toLowerCase();

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(trimmed);
    }
  }

  return result;
}
