// Ollama + phi4-mini auto-setup (ADR-0047) for the vkm-spec local drafting layer.
// Under `--full` the whole stack installs WITHOUT questions (user decision, 4.0.0 plan):
// on Windows that means `winget install Ollama.Ollama --silent` when the binary is
// missing, then `ollama pull phi4-mini:3.8b-q4_K_M` (~2.3GB download, logged loudly).
// Everything here is BEST-EFFORT by contract: vkm-spec's deterministic fallback is a
// CI-pinned invariant, so a failed/skipped Ollama setup degrades the experience, never
// breaks it. Non-Windows platforms get the exact command to run instead of a pipe-to-shell
// install (never curl|sh on the user's behalf).
import { execa } from "execa";
import pc from "picocolors";

export const OLLAMA_MODEL = "phi4-mini:3.8b-q4_K_M";
/** Structured outputs via `format` need ≥0.5.13 for phi4-mini (model requirement). */
export const OLLAMA_MIN_VERSION = "0.5.13";

/** `ollama --version` → semver string or null (missing/unrunnable binary). */
export async function ollamaVersion() {
  const res = await execa("ollama", ["--version"], { reject: false });
  if (res.failed || res.exitCode !== 0) return null;
  return res.stdout?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

/** Best-effort numeric compare: is `version` ≥ `min`? */
export function versionAtLeast(version, min) {
  const a = String(version).split(".").map(Number);
  const b = String(min).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
}

/**
 * Ensure Ollama + the drafting model are available. Never throws; returns a status the
 * caller prints in the summary.
 * @param {boolean} dryRun
 * @param {{ enable?: boolean, platform?: string }} [opts]
 * @returns {Promise<"ready"|"pull-pending"|"restart-needed"|"manual"|"skipped"|"failed">}
 */
export async function maybeInstallOllama(
  dryRun,
  { enable = true, platform = process.platform } = {}
) {
  if (!enable) return "skipped";
  try {
    let version = await ollamaVersion();

    if (!version) {
      if (dryRun) {
        console.log(
          pc.cyan("[dry-run] would install Ollama (winget, silent) + pull"),
          OLLAMA_MODEL
        );
        return "skipped";
      }
      if (platform !== "win32") {
        // Never pipe a remote script to a shell on the user's behalf.
        console.log(
          pc.yellow("Ollama not found — install it manually, then re-run or pull the model:")
        );
        console.log(pc.dim("  https://ollama.com/download  →  ollama pull " + OLLAMA_MODEL));
        return "manual";
      }
      console.log(pc.cyan("Installing Ollama via winget (silent) …"));
      const res = await execa(
        "winget",
        [
          "install",
          "--id",
          "Ollama.Ollama",
          "--silent",
          "--accept-package-agreements",
          "--accept-source-agreements"
        ],
        { reject: false, stdio: "inherit" }
      );
      if (res.failed || res.exitCode !== 0) {
        console.warn(
          pc.yellow("winget install failed — install manually: https://ollama.com/download")
        );
        return "failed";
      }
      version = await ollamaVersion();
      if (!version) {
        // Fresh winget installs often need a new shell for PATH; the model pull can't run yet.
        console.log(
          pc.yellow("Ollama installed but not on PATH yet — open a new terminal and run:"),
          pc.dim(`ollama pull ${OLLAMA_MODEL}`)
        );
        return "restart-needed";
      }
    }

    if (!versionAtLeast(version, OLLAMA_MIN_VERSION)) {
      console.warn(
        pc.yellow(
          `Ollama ${version} < ${OLLAMA_MIN_VERSION} (needed by ${OLLAMA_MODEL}) — update it:`
        ),
        pc.dim("https://ollama.com/download")
      );
      return "manual";
    }

    if (dryRun) {
      console.log(pc.cyan("[dry-run] would pull"), OLLAMA_MODEL, pc.dim("(~2.3GB, idempotent)"));
      return "skipped";
    }
    console.log(pc.cyan(`Pulling ${OLLAMA_MODEL} (~2.3GB — skips if already present) …`));
    const pull = await execa("ollama", ["pull", OLLAMA_MODEL], { reject: false, stdio: "inherit" });
    if (pull.failed || pull.exitCode !== 0) {
      console.warn(
        pc.yellow(
          "Model pull failed (network/disk?) — vkm-spec will use its deterministic fallback."
        ),
        pc.dim(`Retry later: ollama pull ${OLLAMA_MODEL}`)
      );
      return "pull-pending";
    }
    console.log(pc.green("Ollama ready:"), pc.dim(`${OLLAMA_MODEL} (v${version})`));
    return "ready";
  } catch (e) {
    console.warn(pc.yellow("Ollama setup skipped:"), e?.message || e);
    return "failed";
  }
}
