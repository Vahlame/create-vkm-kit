export function parseRange(s) {
  const trimmed = s.trim();

  if (trimmed === "") {
    throw new Error("Input cannot be empty or whitespace-only");
  }

  const tokens = trimmed.split(",");
  const numbers = new Set();

  for (const token of tokens) {
    const trimmedToken = token.trim();

    if (trimmedToken === "") {
      throw new Error("Empty token");
    }

    if (trimmedToken.includes("-")) {
      const parts = trimmedToken.split("-");

      if (parts.length !== 2) {
        throw new Error(`Malformed token: ${trimmedToken}`);
      }

      const aPart = parts[0].trim();
      const bPart = parts[1].trim();

      if (aPart === "" || bPart === "") {
        throw new Error(`Malformed token: ${trimmedToken}`);
      }

      const a = parseInteger(aPart);
      const b = parseInteger(bPart);

      if (a > b) {
        throw new Error(`Reversed range: ${a}-${b}`);
      }

      for (let i = a; i <= b; i++) {
        numbers.add(i);
      }
    } else {
      numbers.add(parseInteger(trimmedToken));
    }
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

function parseInteger(s) {
  if (!/^\d+$/.test(s)) {
    throw new Error(`Invalid number: ${s}`);
  }

  return parseInt(s, 10);
}
