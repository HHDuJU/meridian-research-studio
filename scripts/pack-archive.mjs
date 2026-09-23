#!/usr/bin/env node
/**
 * Pack a private Meridian working-tree archive.
 * packedAt is Date.toISOString() at pack time. MANIFEST.json does not list itself.
 * Runs scripts/verify-archive.mjs before writing the sidecar.
 *
 * Usage: node scripts/pack-archive.mjs [name]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { sourceManifest, treeSha256 } from "./tree-digest.mjs";

const ROOT = path.resolve(".");
const name = process.argv[2] || `meridian-l1-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
const packedAt = new Date().toISOString();
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-pack-"));
const destRoot = path.join(staging, name);

const entries = sourceManifest(ROOT);
fs.mkdirSync(destRoot, { recursive: true });
for (const rel of entries.map((e) => e.path)) {
  const src = path.join(ROOT, rel);
  const dst = path.join(destRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

const clockNote = "sandbox clock unverified";
const digest = treeSha256(ROOT);
const walkHash = crypto.createHash("sha256");
for (const e of entries) walkHash.update(`${e.path}\0${e.sha256}\n`);
const walkSha256 = walkHash.digest("hex");
const manifest = {
  name: `${name}.tar.gz`,
  kind: "deliverable-1b-l1",
  packedAt,
  source: "workspace working tree, no git",
  clockNote,
  treeSha256: digest,
  walkSha256,
  files: entries,
  fileCount: entries.length,
};
fs.writeFileSync(path.join(destRoot, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const verify = spawnSync(process.execPath, [path.join(ROOT, "scripts/verify-archive.mjs"), destRoot], { encoding: "utf8" });
process.stdout.write(verify.stdout || "");
process.stderr.write(verify.stderr || "");
if (verify.status !== 0) {
  console.error("verify-archive failed; not packing");
  process.exit(verify.status ?? 1);
}

const outDir = path.join(ROOT, "public/artifacts");
fs.mkdirSync(outDir, { recursive: true });
const tarPath = path.join(outDir, `${name}.tar.gz`);
const tar = spawnSync("tar", ["-C", staging, "-czf", tarPath, name], { encoding: "utf8" });
if (tar.status !== 0) {
  console.error(tar.stderr);
  process.exit(1);
}
const hash = crypto.createHash("sha256").update(fs.readFileSync(tarPath)).digest("hex");
const bytes = fs.statSync(tarPath).size;
if (bytes > 100 * 1024 * 1024) {
  console.error(`tree archive is ${bytes} bytes, over 100 MB`);
  process.exit(1);
}
const sidecar = `${hash}  ${name}.tar.gz\npackedAt ${packedAt}\ntreeSha256 ${digest}\nwalkSha256 ${walkSha256}\n`;
fs.writeFileSync(`${tarPath}.sha256`, sidecar);
fs.copyFileSync(tarPath, `${tarPath}.bin`);
fs.mkdirSync(path.join(ROOT, "artifacts"), { recursive: true });
fs.copyFileSync(`${tarPath}.sha256`, path.join(ROOT, "artifacts", `${name}.tar.gz.sha256`));
fs.copyFileSync(tarPath, path.join(ROOT, "artifacts", `${name}.tar.gz`));

console.log(JSON.stringify({ tarPath, binPath: `${tarPath}.bin`, sidecar: `${tarPath}.sha256`, sha256: hash, packedAt, treeSha256: digest, walkSha256, fileCount: entries.length, bytes }, null, 2));
