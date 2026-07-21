export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new TypeError('Input must be an array');
  }

  const seen = new Set();
  const result = [];

  for (const email of list) {
    if (typeof email !== 'string') {
      throw new TypeError('All entries must be strings');
    }

    const normalized = email.trim().toLowerCase();

    if (normalized === '') {
      throw new Error('Empty email after trim');
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(email.trim());
    }
  }

  return result;
}
