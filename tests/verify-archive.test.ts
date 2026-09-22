import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

function sha256(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

test("verify_archive_detects_a_changed_byte", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-manifest-"));
  const payload = path.join(dir, "hello.txt");
  fs.writeFileSync(payload, "abc");
  const verifierSrc = fs.readFileSync(new URL("../scripts/verify-archive.mjs", import.meta.url));
  const verifierPath = path.join(dir, "scripts", "verify-archive.mjs");
  fs.mkdirSync(path.dirname(verifierPath), { recursive: true });
  fs.writeFileSync(verifierPath, verifierSrc);
  const files = [
    { path: "hello.txt", bytes: 3, sha256: sha256("abc") },
    { path: "scripts/verify-archive.mjs", bytes: verifierSrc.length, sha256: sha256(verifierSrc) },
  ];
  fs.writeFileSync(
    path.join(dir, "MANIFEST.json"),
    JSON.stringify({ name: "t", packedAt: new Date().toISOString(), files }, null, 2),
  );
  const ok = spawnSync(process.execPath, ["scripts/verify-archive.mjs", dir], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  // invoke against the temp dir
  const ok2 = spawnSync(process.execPath, [path.resolve("scripts/verify-archive.mjs"), dir], { encoding: "utf8" });
  assert.equal(ok2.status, 0, ok2.stdout + ok2.stderr);

  const buf = Buffer.from("abc");
  buf[1] = buf[1] ^ 0xff;
  fs.writeFileSync(payload, buf);
  const bad = spawnSync(process.execPath, [path.resolve("scripts/verify-archive.mjs"), dir], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout, /mismatched/);
  void ok;
});
