export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new Error("Input must be an array");
  }
  const seen = new Set();
  const result = [];
  for (const email of list) {
    if (typeof email !== "string") {
      throw new Error(`Email must be a string, got ${typeof email}`);
    }
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      throw new Error("Email cannot be empty or whitespace-only");
    }
    const parts = normalized.split("@");
    if (parts.length !== 2) {
      throw new Error(`Invalid email: "${email}"`);
    }
    const [localPart, domain] = parts;
    if (!localPart) throw new Error(`Invalid email: "${email}"`);
    if (!domain) throw new Error(`Invalid email: "${email}"`);
    if (!domain.includes(".")) throw new Error(`Invalid email: "${email}"`);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}
