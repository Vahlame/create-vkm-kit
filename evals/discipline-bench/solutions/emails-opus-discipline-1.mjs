const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function dedupeEmails(list) {
  if (!Array.isArray(list)) {
    throw new TypeError(`dedupeEmails expected an array, received ${typeof list}`);
  }

  const seen = new Set();
  const result = [];

  for (const entry of list) {
    if (typeof entry !== "string") {
      throw new TypeError(`Invalid email entry: expected a string, received ${typeof entry}`);
    }

    const email = entry.trim().toLowerCase();

    if (email === "") {
      throw new Error("Invalid email entry: empty or whitespace-only string");
    }
    if (!EMAIL_RE.test(email)) {
      throw new Error(`Invalid email address: "${entry}"`);
    }

    if (!seen.has(email)) {
      seen.add(email);
      result.push(email);
    }
  }

  return result;
}
