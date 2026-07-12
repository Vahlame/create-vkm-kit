export function dedupeEmails(list) {
  if (!Array.isArray(list)) throw new Error("Input must be an array");
  const seen = new Set();
  const result = [];
  for (const email of list) {
    if (typeof email !== "string") throw new Error("All elements must be strings");
    const trimmed = email.trim();
    if (!trimmed) throw new Error("Email cannot be empty or whitespace-only");
    const normalized = trimmed.toLowerCase();
    const atCount = (normalized.match(/@/g) || []).length;
    if (atCount !== 1) throw new Error(`Invalid email format: "${email}"`);
    const [localPart, domain] = normalized.split("@");
    if (!localPart) throw new Error(`Invalid email format: "${email}"`);
    if (!domain || !domain.includes(".")) throw new Error(`Invalid email format: "${email}"`);
    if (domain.split(".").some((p) => !p)) throw new Error(`Invalid email format: "${email}"`);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}
