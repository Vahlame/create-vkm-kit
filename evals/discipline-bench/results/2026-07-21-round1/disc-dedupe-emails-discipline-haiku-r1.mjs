export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new TypeError(`Expected array, got ${typeof list}`);
  }

  const seen = new Set();
  const result = [];

  for (let i = 0; i < list.length; i++) {
    const email = list[i];

    if (typeof email !== 'string') {
      throw new TypeError(`Email at index ${i} must be string, got ${typeof email}`);
    }

    const trimmed = email.trim();

    if (!trimmed) {
      throw new Error(`Email at index ${i} is empty after trimming`);
    }

    // Validate basic email format: has @ and domain with dot
    const atIndex = trimmed.indexOf('@');
    const dotIndex = trimmed.lastIndexOf('.');

    if (atIndex === -1 || dotIndex === -1 || dotIndex <= atIndex) {
      throw new Error(`Invalid email format at index ${i}: "${email}"`);
    }

    const normalized = trimmed.toLowerCase();

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(trimmed);
    }
  }

  return result;
}
