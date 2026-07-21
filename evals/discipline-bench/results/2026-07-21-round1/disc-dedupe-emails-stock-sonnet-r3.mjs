export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new TypeError('dedupeEmails expects an array of email strings');
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seen = new Set();
  const result = [];

  for (const entry of list) {
    if (typeof entry !== 'string') {
      throw new TypeError(`Invalid email entry: ${JSON.stringify(entry)}`);
    }

    const trimmed = entry.trim();

    if (trimmed === '' || !emailPattern.test(trimmed)) {
      throw new TypeError(`Invalid email address: ${JSON.stringify(entry)}`);
    }

    const key = trimmed.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }

  return result;
}
