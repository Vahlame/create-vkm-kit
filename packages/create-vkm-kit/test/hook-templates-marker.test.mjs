import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KIT_FILE_MARKER, isKitOwnedFile } from "../src/settings-io.mjs";

const hooksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks");

// ADR-0041: "write-new, accept-legacy for >=2 majors" — a file a FRESH install
// writes today must carry the NEW marker, not rely solely on the legacy
// fallback. Without this, trimming LEGACY_FILE_MARKERS per the ADR's own
// stated timeline would silently stop `--uninstall` from recognizing these
// exact files as kit-owned, on every machine, old and new alike.
const FRESH_INSTALL_HOOKS = [
  "_transcript-cache.mjs",
  "guard-effort-gate.mjs",
  "guard-native-memory-write.mjs",
  "session-start-vault-context.mjs",
  "stop-vault-close-reminder.mjs",
  "compact-mcp-output.mjs",
  "compact-tool-output.mjs",
  "ensure-otel-sink.mjs"
];

for (const name of FRESH_INSTALL_HOOKS) {
  test(`${name} is recognized as kit-owned via the NEW marker alone`, async () => {
    const fp = path.join(hooksDir, name);
    assert.equal(
      await isKitOwnedFile(fp, [KIT_FILE_MARKER]),
      true,
      `${name} must contain "${KIT_FILE_MARKER}" so --uninstall still finds it once the legacy marker is eventually trimmed`
    );
  });
}
