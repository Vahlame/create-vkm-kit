export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new Error("Input must be an array");
  }

  const seen = new Set();
  const result = [];

  for (const email of list) {
    if (typeof email !== "string") {
      throw new Error("All elements must be strings");
    }

    const normalized = email.trim().toLowerCase();

    if (!normalized || !normalized.includes("@")) {
      throw new Error(`Invalid email: "${email}"`);
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(email);
    }
  }

  return result;
}
