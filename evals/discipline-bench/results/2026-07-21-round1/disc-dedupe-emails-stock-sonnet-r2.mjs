export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new TypeError('dedupeEmails expects an array of email strings');
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seen = new Set();
  const result = [];

  for (const raw of list) {
    if (typeof raw !== 'string') {
      throw new TypeError(`Invalid email entry: ${JSON.stringify(raw)}`);
    }

    const trimmed = raw.trim();

    if (!EMAIL_RE.test(trimmed)) {
      throw new TypeError(`Invalid email address: ${JSON.stringify(raw)}`);
    }

    const key = trimmed.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }

  return result;
}
