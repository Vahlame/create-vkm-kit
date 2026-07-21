const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new TypeError('dedupeEmails: `list` must be an array');
  }

  const seen = new Set();
  const result = [];

  for (const entry of list) {
    if (typeof entry !== 'string') {
      throw new TypeError(`dedupeEmails: invalid email entry: ${JSON.stringify(entry)}`);
    }

    const trimmed = entry.trim();

    if (trimmed === '' || !EMAIL_RE.test(trimmed)) {
      throw new TypeError(`dedupeEmails: invalid email address: ${JSON.stringify(entry)}`);
    }

    const key = trimmed.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }

  return result;
}
