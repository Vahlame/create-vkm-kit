#!/usr/bin/env node
/**
 * Cursor `afterFileEdit` hook — counts substantive edits for the stop reminder.
 * Installed by create-vkm-kit (vkm-kit). Always fail-open (empty stdout).
 */
import { pathToFileURL } from "node:url";
import { noteFileEdit } from "./cursor-session-state.mjs";

export function main() {
  noteFileEdit();
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    /* fail open */
  }
}
