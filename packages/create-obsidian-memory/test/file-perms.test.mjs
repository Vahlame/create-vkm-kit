import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { restrictFileToOwner } from "../src/file-perms.mjs";

// ---- item 4: chmod 0o600 was skipped entirely on win32; restrictFileToOwner fixes that
// with an icacls ACL reset (POSIX keeps chmod 0600). One assertion per platform; the
// content-preservation + never-throws tests run everywhere.

test("restrictFileToOwner narrows a file to 0600 on POSIX", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX-only assertion");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-posix-"));
  const fp = path.join(dir, "f.json");
  fs.writeFileSync(fp, "{}");
  await restrictFileToOwner(fp);
  const mode = fs.statSync(fp).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("restrictFileToOwner resets the ACL to just the current user on Windows (icacls)", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only assertion");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-win-"));
  const fp = path.join(dir, "f.json");
  fs.writeFileSync(fp, "{}");

  await restrictFileToOwner(fp);

  const out = execFileSync("icacls", [fp], { encoding: "utf8" });
  // /inheritance:r strips every inherited ACE — icacls marks those "(I)"; after our reset
  // none should remain, regardless of what the default inherited ACL happened to grant.
  assert.doesNotMatch(out, /\(I\)/, "no inherited ACEs remain");
  const username = process.env.USERNAME || os.userInfo().username;
  assert.match(
    out,
    new RegExp(`${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\(F\\)`),
    "current user explicitly granted Full control"
  );
});

test("restrictFileToOwner never throws and never corrupts the file's content", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-safe-"));
  const fp = path.join(dir, "f.json");
  const content = '{"a":1}';
  fs.writeFileSync(fp, content);
  await restrictFileToOwner(fp);
  assert.equal(fs.readFileSync(fp, "utf8"), content, "content untouched");
});

test("restrictFileToOwner on a missing file resolves without throwing (best-effort)", async () => {
  const fp = path.join(os.tmpdir(), `does-not-exist-perm-${Date.now()}.json`);
  await assert.doesNotReject(() => restrictFileToOwner(fp));
});
