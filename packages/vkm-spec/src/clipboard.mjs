/** Thin wrapper so the rest of the codebase doesn't depend on `clipboardy` directly. */
import clipboardy from "clipboardy";

/** @param {string} text */
export async function copyToClipboard(text) {
  await clipboardy.write(text);
}
