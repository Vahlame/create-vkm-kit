// Core of the vkm-kit autoupdater. Pure planning + apply logic — no CLI wiring here (a
// sibling module owns the `--update` flag and console output).
//
// WHY THIS EXISTS: once installed, skills/agents live under `~/.claude/` as real files the
// user owns and may edit. Today the only way to pick up a newer kit release's improvements
// is re-running the whole installer, which overwrites unconditionally — `installManagedAssets`
// in asset-install.mjs documents that policy in so many words ("Install always overwrites").
// That's fine for a first install but wrong for an update: it can't tell "the kit changed this
// file" from "the user customized this file" apart, so it would silently clobber edits.
//
// The sidecar manifest (`~/.claude/vkm-kit.assets.json`) already records the hash of every
// file AS INSTALLED — that's exactly the missing third state. Comparing TEMPLATE (what the new
// kit version ships), RECORDED (what was installed last time — the common ancestor) and DISK
// (what's actually there now) is a three-way merge base, the same model chezmoi uses
// (source/target/destination) and the same problem shadcn/ui's `diff` command solves for files
// copied into a user's own repo. With the ancestor known, "the user edited this" and "the kit
// changed this" stop being the same observable event, so an update can apply the safe majority
// (new/missing/update) and refuse to silently overwrite a real conflict (both sides changed).
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fse from "fs-extra";
import { atomicWriteJson, readSettingsSafe } from "./settings-io.mjs";

/** All states {@link classifyAsset} can return. */
export const UPDATE_STATES = [
  "new",
  "unchanged",
  "update",
  "local-only",
  "conflict",
  "missing",
  "orphan",
  "untracked"
];

/** States a plain `--update` writes without confirmation — the safe majority where only one
 * side of the three-way comparison changed (or the file simply isn't there yet). */
export const APPLY_BY_DEFAULT = new Set(["new", "missing", "update"]);

/**
 * States `--force` additionally overwrites — every state that means "you edited this file",
 * regardless of whether the kit ALSO changed it.
 *
 * Both belong here, and leaving `local-only` out was a real trap found by an end-to-end run:
 * a file the user edited that the kit has NOT since changed is `local-only`, not `conflict`,
 * and that is the COMMON case (the kit changes any given file rarely). With only `conflict`
 * forcible, `--force` silently did nothing for it — worse than an error, because the user
 * asked to discard their edits, was told the run succeeded, and still had the old file. From
 * the user's side "force" means one thing: make the managed files match what the kit ships.
 * The distinction that matters is DEFAULT behavior (never touch either) — not what an explicit,
 * documented, edit-discarding flag reaches.
 */
export const FORCIBLE = new Set(["conflict", "local-only"]);

/**
 * sha256 hex digest of file bytes. Duplicated from `asset-install.mjs`'s private `sha256`
 * (not exported there) rather than imported, because that module has no export for it — the
 * two MUST stay byte-for-byte identical (same algorithm, same digest encoding) or every asset
 * installed by one and compared by the other would spuriously read as changed.
 * @param {Buffer} bytes
 * @returns {string}
 */
function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Classify one asset from its three hashes into a single {@link UPDATE_STATES} member.
 * `null`/`undefined` means "absent" on every input. Branches are evaluated in the documented
 * order — several conditions overlap in isolation (e.g. `diskHash === recordedHash` when both
 * are `null` would also be true) and the order is what disambiguates them.
 * @param {{ templateHash?: string | null, recordedHash?: string | null, diskHash?: string | null }} hashes
 * @returns {typeof UPDATE_STATES[number]}
 */
export function classifyAsset({ templateHash, recordedHash, diskHash }) {
  const t = templateHash ?? null;
  const r = recordedHash ?? null;
  const d = diskHash ?? null;

  if (t === null && r === null) return "untracked"; // not ours; never touch
  if (t === null) return "orphan"; // kit dropped this file
  if (r === null && d === null) return "new"; // new file this version
  if (r === null && d !== null) return "untracked"; // same-named file we never installed
  if (d === null) return "missing"; // user deleted it; reinstalling is safe
  if (d === r && t === r) return "unchanged";
  if (d === r && t !== r) return "update"; // safe: only the kit changed
  if (d !== r && t === r) return "local-only"; // only the user changed: keep
  return "conflict"; // both changed: never silently overwrite
}

/** Read the sidecar manifest (missing/corrupt → empty manifest; never throws). Same
 * degrade-to-empty contract as `asset-install.mjs`'s private `readSidecar`, extended with the
 * optional `kitVersion` top-level string (SIDECAR SCHEMA EXTENSION): a sidecar written by an
 * older kit simply lacks the key, which reads as `null` ("unknown"), never an error.
 * @param {string} sidecarFp
 * @returns {Promise<{ version: 1, assets: Record<string, {hash: string, installedAt: string}>, kitVersion: string | null }>}
 */
async function readSidecarManifest(sidecarFp) {
  const { existing, invalidJson } = await readSettingsSafe(sidecarFp);
  if (invalidJson || typeof existing.assets !== "object" || existing.assets === null) {
    return { version: 1, assets: {}, kitVersion: null };
  }
  return {
    version: 1,
    assets: { ...existing.assets },
    kitVersion: typeof existing.kitVersion === "string" ? existing.kitVersion : null
  };
}

/** Persist the manifest via the same atomic/crash-safe primitive the rest of the installer
 * uses; deletes the sidecar entirely once no assets remain (no trace), mirroring
 * `asset-install.mjs`'s `writeSidecar`.
 * @param {string} sidecarFp
 * @param {{ version: 1, assets: Record<string, unknown>, kitVersion?: string | null }} manifest
 */
async function writeSidecarManifest(sidecarFp, manifest) {
  if (Object.keys(manifest.assets).length === 0) {
    await fse.remove(sidecarFp);
    return;
  }
  await atomicWriteJson(sidecarFp, manifest);
}

async function defaultCopy(src, dest) {
  await fse.ensureDir(path.dirname(dest));
  await fse.copy(src, dest, { overwrite: true });
}

async function defaultRemove(dest) {
  await fse.remove(dest);
}

/**
 * sha256 of a path's bytes, or `null` if it's absent/unreadable — never throws. `existsImpl`
 * gates the read so tests can simulate "recorded but gone" without a real filesystem race, and
 * `readFileImpl` is still wrapped in try/catch for permission errors etc.
 * @param {string} fp
 * @param {(fp: string) => Promise<Buffer>} readFileImpl
 * @param {(fp: string) => Promise<boolean>} existsImpl
 * @returns {Promise<string | null>}
 */
async function hashPath(fp, readFileImpl, existsImpl) {
  if (!fp || !(await existsImpl(fp))) return null;
  try {
    return sha256(await readFileImpl(fp));
  } catch {
    return null;
  }
}

/**
 * Build the three-way plan: for every `{src, dest}` the kit currently wants to ship, compare
 * TEMPLATE (src, i.e. what THIS version of the kit ships) vs RECORDED (the sidecar, i.e. what
 * was installed last time) vs DISK (dest, i.e. what's there now). Also emits an "orphan" entry
 * for every dest the sidecar still remembers that isn't in `files` anymore (the kit dropped
 * that file in a later version) — those have no `src` (`null`), since no template exists for
 * them to compare against.
 * @param {object} opts
 * @param {string} opts.home - unused by the comparison itself (dest paths in `files` are
 *   already absolute); accepted for symmetry with `skillAssetFiles(home, …)` callers and kept
 *   for callers that want it echoed back via a future report.
 * @param {{ src: string, dest: string }[]} opts.files
 * @param {string} opts.sidecarFp
 * @param {(fp: string) => Promise<Buffer>} [opts.readFileImpl]
 * @param {(fp: string) => Promise<boolean>} [opts.existsImpl]
 * @returns {Promise<{
 *   entries: Array<{ src: string | null, dest: string, state: string,
 *     templateHash: string | null, recordedHash: string | null, diskHash: string | null }>,
 *   counts: Record<string, number>,
 *   recordedKitVersion: string | null
 * }>}
 */
export async function buildUpdatePlan({
  home,
  files,
  sidecarFp,
  readFileImpl = fse.readFile,
  existsImpl = fse.pathExists
}) {
  void home; // reserved for future relative-path reporting; entries already carry absolute dests
  const manifest = await readSidecarManifest(sidecarFp);
  const entries = [];
  const destsSeen = new Set();

  for (const { src, dest } of files) {
    destsSeen.add(dest);
    const templateHash = await hashPath(src, readFileImpl, existsImpl);
    const recorded = manifest.assets[dest];
    const recordedHash = recorded ? recorded.hash : null;
    const diskHash = await hashPath(dest, readFileImpl, existsImpl);
    entries.push({
      src,
      dest,
      state: classifyAsset({ templateHash, recordedHash, diskHash }),
      templateHash,
      recordedHash,
      diskHash
    });
  }

  for (const [dest, recorded] of Object.entries(manifest.assets)) {
    if (destsSeen.has(dest)) continue;
    const diskHash = await hashPath(dest, readFileImpl, existsImpl);
    entries.push({
      src: null,
      dest,
      state: classifyAsset({ templateHash: null, recordedHash: recorded.hash, diskHash }),
      templateHash: null,
      recordedHash: recorded.hash,
      diskHash
    });
  }

  const counts = /** @type {Record<string, number>} */ (
    Object.fromEntries(UPDATE_STATES.map((s) => [s, 0]))
  );
  for (const entry of entries) counts[entry.state] += 1;

  return { entries, counts, recordedKitVersion: manifest.kitVersion };
}

/** `dest` shortened to a home-relative path when it lives under the current user's home dir
 * (the common case: `~/.claude/...`); falls back to the full path otherwise (temp-dir test
 * fixtures, or a dest outside home). Purely cosmetic — never used for comparison.
 * @param {string} dest
 */
function displayPath(dest) {
  const rel = path.relative(os.homedir(), dest);
  return rel.startsWith("..") ? dest : rel;
}

/**
 * Compact multi-line human report. "unchanged" is always a single count line (never a file
 * list — it's usually the majority of assets and listing them would bury the states that
 * matter); every other non-empty state gets a `state: N` header followed by its dest paths.
 * @param {{ entries: Array<{ dest: string, state: string }>, counts: Record<string, number> }} plan
 * @returns {string}
 */
export function summarizePlan(plan) {
  const lines = [`unchanged: ${plan.counts.unchanged ?? 0}`];
  for (const state of UPDATE_STATES) {
    if (state === "unchanged") continue;
    const entries = plan.entries.filter((e) => e.state === state);
    if (!entries.length) continue;
    lines.push(`${state}: ${entries.length}`);
    for (const entry of entries) lines.push(`  ${displayPath(entry.dest)}`);
  }
  return lines.join("\n");
}

/**
 * Apply a plan: writes every entry whose state is in {@link APPLY_BY_DEFAULT}, plus every
 * state in {@link FORCIBLE} when `force` is true. "orphan" entries are removed only when
 * unmodified (`diskHash === recordedHash`); a modified orphan is left alone and reported in
 * `skipped`, same as `removeManagedAssets`'s policy. "local-only", "untracked" and "unchanged"
 * are never written or removed, but ARE reported in `skipped` for a complete audit trail.
 * @param {object} opts
 * @param {{ entries: Array<{ src: string | null, dest: string, state: string,
 *   templateHash: string | null, recordedHash: string | null, diskHash: string | null }> }} opts.plan
 * @param {string} opts.sidecarFp
 * @param {boolean} [opts.force]
 * @param {boolean} [opts.dryRun] - compute and return the same shape; write nothing
 * @param {(src: string, dest: string) => Promise<void>} [opts.copyImpl]
 * @param {(dest: string) => Promise<void>} [opts.removeImpl]
 * @param {(sidecarFp: string,
 *   manifest: { version: 1, assets: Record<string, unknown>, kitVersion?: string | null }
 *   ) => Promise<void>} [opts.writeSidecarImpl] - `unknown` here would be unsound, not lenient:
 *   parameters are contravariant, so declaring a wider parameter than the default impl
 *   (`writeSidecarManifest`, which dereferences `manifest.assets`) accepts promises callers
 *   something the default cannot honour. An impl taking `unknown` is still assignable to this.
 * @returns {Promise<{ applied: string[], skipped: Array<{ dest: string, state: string }>, removed: string[] }>}
 */
export async function applyUpdatePlan({
  plan,
  sidecarFp,
  force = false,
  dryRun = false,
  copyImpl = defaultCopy,
  removeImpl = defaultRemove,
  writeSidecarImpl = writeSidecarManifest
}) {
  const manifest = await readSidecarManifest(sidecarFp);
  const applied = [];
  const skipped = [];
  const removed = [];

  for (const entry of plan.entries) {
    const { dest, state } = entry;

    if (state === "orphan") {
      const unmodified = entry.diskHash === entry.recordedHash;
      if (unmodified) {
        if (!dryRun) {
          await removeImpl(dest);
          delete manifest.assets[dest];
        }
        removed.push(dest);
      } else {
        skipped.push({ dest, state });
      }
      continue;
    }

    const shouldApply = APPLY_BY_DEFAULT.has(state) || (force && FORCIBLE.has(state));
    if (!shouldApply) {
      skipped.push({ dest, state });
      continue;
    }

    if (!dryRun) {
      await copyImpl(entry.src, dest);
      manifest.assets[dest] = {
        hash: entry.templateHash,
        installedAt: new Date().toISOString()
      };
    }
    applied.push(dest);
  }

  // The sidecar only needs a write when something actually changed it (a write or a removal);
  // stamp the running kit version at the same time so recordedKitVersion tracks the last
  // update that touched anything, not merely the last install.
  if (!dryRun && (applied.length || removed.length)) {
    manifest.kitVersion = readKitVersion();
    await writeSidecarImpl(sidecarFp, manifest);
  }

  return { applied, skipped, removed };
}

/**
 * The installer's own version, read from this package's `package.json`. Never throws — any
 * failure (missing file, bad JSON, missing/non-string `version`) degrades to `"0.0.0"`, since
 * this is used only for an informational sidecar stamp, never a correctness-critical value.
 * @returns {string}
 */
export function readKitVersion() {
  try {
    const pkgFp = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgFp, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
