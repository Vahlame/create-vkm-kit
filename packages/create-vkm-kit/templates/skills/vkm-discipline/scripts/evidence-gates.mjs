#!/usr/bin/env node
/**
 * evidence-gates.mjs — vkm-discipline evidence gate runner, cross-platform.
 *
 * Detects the project's own quality gates and runs them, printing one compact
 * pass/fail block. Zero config, zero deps beyond the project's own toolchain.
 * Behavior mirrors evidence-gates.sh exactly; this Node version is the primary
 * runner (Windows/DSH included), the .sh stays as the POSIX fallback.
 *
 * Exit codes: 0 = every detected gate passed · 1 = at least one failed ·
 * 2 = bad directory · 0 with a notice if nothing was detected (the absence of
 * gates is a finding, not a failure).
 *
 * Usage: node evidence-gates.mjs [project-dir]   (default: current directory)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? ".");
if (!existsSync(dir)) {
  // stdout on purpose — mirrors the .sh fallback (`echo`), so both streams agree
  // and the test/CI capture sees it regardless of stream handling.
  console.log(`evidence-gates: cannot cd to ${dir}`);
  process.exit(2);
}
process.chdir(dir);

const PASS = [];
const FAIL = [];
const RAN = [];

function runGate(label, cmd, args) {
  // Windows: .cmd/.bat shims (npm) cannot be spawned directly — EINVAL without a shell.
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
  const r = spawnSync(cmd, args, { encoding: "utf8", shell });
  RAN.push(label);
  if (r.error) {
    FAIL.push({ label, out: `[spawn failed: ${r.error.message}]` });
    return;
  }
  if (r.status === 0) {
    PASS.push(label);
  } else {
    // Show the tail — the decisive lines of a failing gate are at the end.
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    FAIL.push({ label, out: out.split(/\r?\n/).filter(Boolean).slice(-15).join("\n") });
  }
}

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

/** Is the binary resolvable on PATH? (Windows: `where`; elsewhere: `command -v`.) */
function hasBin(bin) {
  const r =
    process.platform === "win32"
      ? spawnSync("where", [bin], { encoding: "utf8", stdio: "ignore" })
      : spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8", stdio: "ignore" });
  return r.status === 0;
}

function hasNpmScript(name) {
  if (!existsSync("package.json")) return false;
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    return typeof pkg.scripts?.[name] === "string";
  } catch {
    return false;
  }
}

function hasPythonTests() {
  if (!existsSync("tests")) return false;
  return readdirSync("tests").some((f) => f.endsWith(".py"));
}

if (existsSync("package.json")) {
  for (const s of ["test", "lint", "typecheck"]) {
    if (hasNpmScript(s)) runGate(`npm run ${s}`, npmBin, ["run", "--silent", s]);
  }
}

if (existsSync("go.mod")) {
  runGate("go test ./...", "go", ["test", "./..."]);
  if (hasBin("gofmt")) {
    const r = spawnSync("gofmt", ["-l", "."], { encoding: "utf8" });
    const unfmt = String(r.stdout ?? "")
      .split(/\r?\n/)
      .filter((l) => l && !l.includes("vendor"));
    if (unfmt.length) FAIL.push({ label: "gofmt -l", out: unfmt.join("\n") });
    else PASS.push("gofmt -l");
    RAN.push("gofmt -l");
  }
}

if (
  (existsSync("pyproject.toml") || existsSync("setup.py") || hasPythonTests()) &&
  hasBin("pytest")
) {
  runGate("pytest -q", "pytest", ["-q"]);
}

if (existsSync("Cargo.toml")) {
  runGate("cargo test", "cargo", ["test", "--quiet"]);
}

if (existsSync("Makefile") && RAN.length === 0) {
  const mk = readFileSync("Makefile", "utf8");
  if (/^test:/m.test(mk)) runGate("make test", "make", ["test"]);
}

console.log(`evidence-gates: ${process.cwd()}`);
for (const p of PASS) console.log(`PASS  ${p}`);
for (const f of FAIL) {
  console.log(`FAIL  ${f.label}`);
  console.log(f.out.split("\n").map((l) => `      ${l}`).join("\n"));
}
console.log("----");
if (RAN.length === 0) {
  console.log("evidence-gates: no gates detected (no npm scripts/go.mod/pytest/cargo/make test).");
  console.log("That absence IS the finding — verify by exercising the change directly and say so.");
  process.exit(0);
}
console.log(`evidence-gates: ${PASS.length} passed, ${FAIL.length} failed (${RAN.length} gate(s) run)`);
process.exit(FAIL.length ? 1 : 0);
