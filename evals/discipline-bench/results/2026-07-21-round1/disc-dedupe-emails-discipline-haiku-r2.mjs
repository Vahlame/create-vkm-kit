export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new TypeError('Input must be an array');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seen = new Set();
  const result = [];

  for (const email of list) {
    if (typeof email !== 'string') {
      throw new TypeError(`Expected string, got ${typeof email}`);
    }

    const trimmed = email.trim();

    if (trimmed === '') {
      throw new Error('Empty email address');
    }

    if (!emailRegex.test(trimmed)) {
      throw new Error(`Invalid email format: "${email}"`);
    }

    const normalized = trimmed.toLowerCase();

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}
