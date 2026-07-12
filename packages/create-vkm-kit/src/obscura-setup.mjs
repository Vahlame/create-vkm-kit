// Obscura headless-browser auto-setup (ADR-0051) for the obscura-web MCP (stealth web
// fetch + robust search). Under `--full`/`--obscura` the PINNED release is downloaded, its
// SHA-256 verified against a baked-in value, and extracted to ~/.vkm/obscura/.
//
// BEST-EFFORT by contract: a failed/skipped setup degrades obscura-web (its tools steer the
// agent to the native WebFetch/WebSearch) but NEVER breaks the install. obscura is a
// third-party binary from a pseudonymous author — we pin the version and verify the hash,
// but cannot audit the binary itself; verification REFUSES to run bytes that don't match the
// baked-in digest, and the CDP server is never involved (obscura-web uses per-request
// `obscura fetch`, so no port is opened). Non-Windows still gets a real binary, not a
// pipe-to-shell installer.
//
// Attribution: obscura is licensed Apache-2.0 (© its authors, github.com/h4ckf0r0day/obscura).
// The kit DOWNLOADS the official release to the user's machine — it does not bundle or
// redistribute obscura's code/binary — and credits it at install time (console note below).
import { execa } from "execa";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";

export const OBSCURA_VERSION = "0.1.10";

/** Sentinel for an un-filled checksum: setup refuses to run an unverifiable download. */
export const CHECKSUM_PLACEHOLDER = "REPLACE_WITH_REAL_SHA256";

// Release assets — github.com/h4ckf0r0day/obscura/releases/tag/v0.1.10. obscura publishes NO
// checksum file, so each sha256 is computed by us from the pinned artifact and baked in here
// (fill via `node scripts/obscura-checksums.mjs`). A mismatch on download means the bytes
// changed upstream → setup refuses to run them. Bumping OBSCURA_VERSION requires recomputing.
export const OBSCURA_ASSETS = {
  "win32-x64": {
    asset: "obscura-x86_64-windows.zip",
    sha256: "238eebe25f5793ff41898e1cf52dc11e8a637c0d799c69aaffe7904cbbb5a858",
    bin: "obscura.exe"
  },
  "linux-x64": {
    asset: "obscura-x86_64-linux.tar.gz",
    sha256: "7efd9d53546b69ed6cc84a47d5c08ee7a7041ee87ab95e7310fda708608a5093",
    bin: "obscura"
  },
  "linux-arm64": {
    asset: "obscura-aarch64-linux.tar.gz",
    sha256: "a50c154970934af3cf9fd2bec6c8a53ff76f25b0c4d9e78c286ce4bc3bca0adf",
    bin: "obscura"
  },
  "darwin-x64": {
    asset: "obscura-x86_64-macos.tar.gz",
    sha256: "cfd74f777be7dccebe0ed1fc4b264f8c4dfb0e52cf929d88acde85365c4e2961",
    bin: "obscura"
  },
  "darwin-arm64": {
    asset: "obscura-aarch64-macos.tar.gz",
    sha256: "a4a868cedf2fb95f2b3af2dc9dacf235eef08398f070387b9a02e65faf1f93e3",
    bin: "obscura"
  }
};

const assetKey = (platform, arch) => `${platform}-${arch}`;

/** The kit's private obscura install dir (~/.vkm/obscura). */
export function obscuraHome() {
  return path.join(os.homedir(), ".vkm", "obscura");
}

/** Expected binary path for a platform/arch, or null if unsupported. */
export function obscuraBinPath(platform = process.platform, arch = process.arch) {
  const spec = OBSCURA_ASSETS[assetKey(platform, arch)];
  return spec ? path.join(obscuraHome(), spec.bin) : null;
}

/** GitHub release download URL for a given asset filename. */
export function downloadUrl(asset) {
  return `https://github.com/h4ckf0r0day/obscura/releases/download/v${OBSCURA_VERSION}/${asset}`;
}

/** Resolve the asset spec for a platform/arch (null if none is published). */
export function resolveSpec(platform = process.platform, arch = process.arch) {
  return OBSCURA_ASSETS[assetKey(platform, arch)] || null;
}

// ── real dependency implementations (injected in tests) ─────────────────────
async function fetchDownload(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function sha256File(fp) {
  return createHash("sha256")
    .update(await fs.readFile(fp))
    .digest("hex");
}

async function tarExtract(archive, dest) {
  // bsdtar (bundled on Windows 10+, macOS, and most Linux) extracts BOTH .zip and .tar.gz.
  const res = await execa("tar", ["-xf", archive, "-C", dest], {
    reject: false,
    windowsHide: true
  });
  if (res.failed || res.exitCode !== 0) {
    throw new Error(`extract failed (tar): ${String(res.stderr || res.shortMessage || "").trim()}`);
  }
}

async function isRunnable(bin) {
  try {
    const res = await execa(bin, ["--version"], {
      reject: false,
      timeout: 8000,
      windowsHide: true
    });
    return !res.failed && res.exitCode === 0;
  } catch {
    return false;
  }
}

/** Find `binName` directly under root or one level down (archives may nest a top folder). */
async function locateBin(root, binName) {
  const direct = path.join(root, binName);
  try {
    await fs.access(direct);
    return direct;
  } catch {
    /* not at root */
  }
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name, binName);
    try {
      await fs.access(p);
      return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Download → verify SHA-256 → extract → locate → confirm runnable. Dependency-injected so
 * it is unit-testable without network. Never runs bytes whose digest != spec.sha256.
 * @param {{ asset: string, sha256: string, bin: string }} spec
 * @param {{ platform?: string, tmpDir?: string, home?: string }} [opts]
 * @param {{ download?: typeof fetchDownload, hashFile?: typeof sha256File, extract?: typeof tarExtract, isRunnable?: typeof isRunnable }} [deps]
 * @returns {Promise<{ status: "ready"|"failed", binPath: string|null }>}
 */
export async function installFromSpec(spec, opts = {}, deps = {}) {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? obscuraHome();
  const tmpDir = opts.tmpDir ?? os.tmpdir();
  const {
    download = fetchDownload,
    hashFile = sha256File,
    extract = tarExtract,
    isRunnable: runnable = isRunnable
  } = deps;

  await fs.mkdir(home, { recursive: true });
  const tmp = path.join(tmpDir, `obscura-${OBSCURA_VERSION}-${process.pid}-${spec.asset}`);
  try {
    await download(downloadUrl(spec.asset), tmp);

    const digest = (await hashFile(tmp)).toLowerCase();
    if (digest !== spec.sha256.toLowerCase()) {
      console.error(
        pc.red(
          `obscura: SHA-256 mismatch (expected ${spec.sha256}, got ${digest}) — refusing to run it.`
        )
      );
      return { status: "failed", binPath: null };
    }

    await extract(tmp, home);

    const binPath = await locateBin(home, spec.bin);
    if (!binPath) {
      console.warn(pc.yellow(`obscura extracted but ${spec.bin} not found under ${home}`));
      return { status: "failed", binPath: null };
    }
    if (platform !== "win32") {
      try {
        await fs.chmod(binPath, 0o755);
      } catch {
        /* best-effort */
      }
    }
    if (await runnable(binPath)) {
      console.log(pc.green("obscura ready:"), pc.dim(`v${OBSCURA_VERSION} @ ${binPath}`));
      return { status: "ready", binPath };
    }
    console.warn(pc.yellow("obscura extracted but not runnable — check " + binPath));
    return { status: "failed", binPath: null };
  } finally {
    // Always remove the downloaded archive — on mismatch, extract failure, or success.
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

/**
 * Ensure the obscura binary is available. Never throws; returns a status the caller prints
 * plus the resolved binary path (null → obscura-web should fall back to `obscura` on PATH).
 * @param {boolean} dryRun
 * @param {{ enable?: boolean, platform?: string, arch?: string }} [opts]
 * @param {{ isRunnable?: typeof isRunnable, installImpl?: typeof installFromSpec }} [deps]
 * @returns {Promise<{ status: "ready"|"manual"|"skipped"|"failed", binPath: string|null }>}
 */
export async function maybeInstallObscura(
  dryRun,
  { enable = true, platform = process.platform, arch = process.arch } = {},
  deps = {}
) {
  if (!enable) return { status: "skipped", binPath: null };
  const { isRunnable: runnable = isRunnable, installImpl = installFromSpec } = deps;

  const spec = resolveSpec(platform, arch);
  if (!spec) {
    console.warn(
      pc.yellow(`obscura: no prebuilt release for ${assetKey(platform, arch)} — install manually:`),
      pc.dim("https://github.com/h4ckf0r0day/obscura/releases")
    );
    return { status: "manual", binPath: null };
  }
  const binPath = path.join(obscuraHome(), spec.bin);

  // Respect an existing install (ours in ~/.vkm/obscura or one already on PATH).
  if (await runnable(binPath)) {
    console.log(pc.green("obscura already installed:"), pc.dim(binPath));
    return { status: "ready", binPath };
  }
  if (await runnable("obscura")) {
    console.log(pc.green("obscura already on PATH — using it."));
    return { status: "ready", binPath: null };
  }

  if (spec.sha256 === CHECKSUM_PLACEHOLDER) {
    // Never download-and-run an unverifiable third-party binary.
    console.warn(
      pc.yellow(
        "obscura: no pinned checksum baked in yet — refusing to auto-run an unverified binary."
      )
    );
    console.log(
      pc.dim(`  Install manually: ${downloadUrl(spec.asset)}  →  extract to ${obscuraHome()}`)
    );
    return { status: "manual", binPath: null };
  }

  if (dryRun) {
    console.log(
      pc.cyan("[dry-run] would download + verify (SHA-256) + extract obscura"),
      pc.dim(`${spec.asset} (v${OBSCURA_VERSION}) → ${obscuraHome()}`)
    );
    return { status: "skipped", binPath };
  }

  try {
    console.log(pc.cyan(`Downloading obscura v${OBSCURA_VERSION} (${spec.asset}) …`));
    console.log(
      pc.dim(
        "  obscura © its authors — Apache-2.0 (github.com/h4ckf0r0day/obscura); official release, downloaded not bundled."
      )
    );
    return await installImpl(spec, { platform });
  } catch (e) {
    console.warn(pc.yellow("obscura setup skipped:"), e?.message || e);
    return { status: "failed", binPath: null };
  }
}
