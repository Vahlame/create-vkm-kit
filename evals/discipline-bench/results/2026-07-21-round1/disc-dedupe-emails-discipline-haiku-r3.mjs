export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new TypeError('Expected an array');
  }

  const seen = new Set();
  const result = [];

  for (const email of list) {
    if (typeof email !== 'string') {
      throw new TypeError(`Expected string, got ${typeof email}`);
    }

    const normalized = email.trim().toLowerCase();

    if (!normalized) {
      throw new Error('Email cannot be empty');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new Error(`Invalid email format: "${email}"`);
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}
