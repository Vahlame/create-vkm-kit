// Managed-asset installer for the template files this kit copies into the user's Claude
// Code profile (output styles, skills, subagent templates) — anything that is a FILE the
// kit owns rather than a key inside settings.json.
//
// Ownership is tracked in a sidecar manifest (`~/.claude/vkm-kit.assets.json`) that records
// the SHA-256 of every file AS INSTALLED. That gives uninstall a stronger guarantee than
// the hooks' marker-string check: a file is deleted only when its current content hash still
// equals the recorded one — a user who edited an installed template keeps their file (with a
// skip report), and a file we never recorded is never touched at all. Install always
// overwrites (kit templates are kit-owned, same policy as the hook scripts; users who want
// to customize should copy under a different name).
//
// No logging here — functions return action reports ({installed, removed, skipped}) and the
// orchestrator owns the console. All I/O goes through the same crash-safe primitives as the
// rest of the installer (`atomicWriteJson` for the sidecar; copy is per-file so a failure
// leaves previous files intact).
import crypto from "node:crypto";
import path from "node:path";
import fse from "fs-extra";
import { atomicWriteJson, readSettingsSafe } from "./settings-io.mjs";

/** Sidecar manifest basename, kept under `~/.claude/`. */
export const ASSETS_SIDECAR_BASENAME = "vkm-kit.assets.json";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** Load the sidecar manifest (missing/corrupt → empty manifest; never throws). */
async function readSidecar(sidecarFp) {
  const { existing, invalidJson } = await readSettingsSafe(sidecarFp);
  if (invalidJson || typeof existing.assets !== "object" || existing.assets === null) {
    return { version: 1, assets: {} };
  }
  return { version: 1, assets: { ...existing.assets } };
}

/** Persist the manifest; deletes the file entirely when no assets remain (no trace). */
async function writeSidecar(sidecarFp, manifest) {
  if (Object.keys(manifest.assets).length === 0) {
    await fse.remove(sidecarFp);
    return;
  }
  await atomicWriteJson(sidecarFp, manifest);
}

/**
 * Copy each `{src, dest}` pair into place and record its content hash in the sidecar.
 * Overwrites existing files (kit-owned templates); re-runs converge on the same state.
 * @param {object} opts
 * @param {{ src: string, dest: string }[]} opts.files - absolute paths
 * @param {string} opts.sidecarFp - absolute path of the sidecar manifest
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ installed: string[] }>} dest paths written (or that would be)
 */
export async function installManagedAssets({ files, sidecarFp, dryRun = false }) {
  const installed = [];
  if (dryRun) {
    return { installed: files.map((f) => f.dest) };
  }
  const manifest = await readSidecar(sidecarFp);
  for (const { src, dest } of files) {
    const bytes = await fse.readFile(src);
    await fse.ensureDir(path.dirname(dest));
    await fse.copy(src, dest, { overwrite: true });
    manifest.assets[dest] = { hash: sha256(bytes), installedAt: new Date().toISOString() };
    installed.push(dest);
  }
  await writeSidecar(sidecarFp, manifest);
  return { installed };
}

/**
 * Remove managed assets: every file recorded in the sidecar (optionally narrowed to
 * `dests`) is deleted IFF its current content hash still equals the recorded one. Modified
 * files are skipped (and reported) but their manifest entry is dropped either way — after an
 * uninstall the kit no longer claims them. Missing files just drop their entry.
 * @param {object} opts
 * @param {string} opts.sidecarFp
 * @param {string[]} [opts.dests] - narrow removal to these dest paths (default: all recorded)
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ removed: string[], skipped: string[] }>}
 */
export async function removeManagedAssets({ sidecarFp, dests, dryRun = false }) {
  const manifest = await readSidecar(sidecarFp);
  const targets = dests ?? Object.keys(manifest.assets);
  const removed = [];
  const skipped = [];
  for (const dest of targets) {
    const entry = manifest.assets[dest];
    if (!entry) continue;
    let unmodified;
    try {
      unmodified = sha256(await fse.readFile(dest)) === entry.hash;
    } catch {
      // Missing/unreadable: nothing to delete; just release the claim below.
      unmodified = false;
    }
    if (unmodified) {
      if (!dryRun) await fse.remove(dest);
      removed.push(dest);
    } else if (await fse.pathExists(dest)) {
      skipped.push(dest);
    }
    if (!dryRun) delete manifest.assets[dest];
  }
  if (!dryRun) await writeSidecar(sidecarFp, manifest);
  return { removed, skipped };
}
