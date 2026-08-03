/**
 * Shared sidecar for Cursor hooks that need cross-event session state.
 * Cursor has no Claude-style JSONL transcript_path, so afterFileEdit /
 * afterMCPExecution accumulate counters that `stop` reads. Fail-open always.
 *
 * Installed by create-vkm-kit (vkm-kit).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VAULT_WRITE =
  /vault_write_file|vault_edit_file|vault_append_file|vault_frontmatter_set|memory_extract_candidates|write_note|edit_note/;

export function statePath(home = os.homedir()) {
  return path.join(home, ".vkm", "cursor-session-state.json");
}

export function emptyState() {
  return { substantive: 0, vaultTouches: 0, nudged: false, startedAt: Date.now() };
}

export function readState(home = os.homedir()) {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(home), "utf8"));
    if (!raw || typeof raw !== "object") return emptyState();
    return {
      substantive: Number(raw.substantive) || 0,
      vaultTouches: Number(raw.vaultTouches) || 0,
      nudged: Boolean(raw.nudged),
      startedAt: Number(raw.startedAt) || Date.now()
    };
  } catch {
    return emptyState();
  }
}

export function writeState(state, home = os.homedir()) {
  try {
    const fp = statePath(home);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(state), "utf8");
  } catch {
    /* fail open */
  }
}

export function resetState(home = os.homedir()) {
  writeState(emptyState(), home);
}

export function noteFileEdit(home = os.homedir()) {
  const s = readState(home);
  s.substantive += 1;
  writeState(s, home);
  return s;
}

/** @param {string} toolName */
export function noteMcpTool(toolName, home = os.homedir()) {
  if (typeof toolName !== "string" || !VAULT_WRITE.test(toolName)) return readState(home);
  const s = readState(home);
  s.vaultTouches += 1;
  writeState(s, home);
  return s;
}

export function markNudged(home = os.homedir()) {
  const s = readState(home);
  s.nudged = true;
  writeState(s, home);
  return s;
}

export { VAULT_WRITE };
