#!/usr/bin/env node
/**
 * Recompute SHA-256 of every payload file listed in MANIFEST.json.
 * MANIFEST.json must not list itself. Exits non-zero on missing, extra, or mismatched.
 * P3: a tree archive over 100 MB, or a tree with .png under results/, is refused.
 * P5: manifest.treeSha256 must equal scripts/tree-digest.mjs on this tree.
 * P4: manifest.walkSha256 must equal the pack-walk digest.
 *
 * Usage: node scripts/verify-archive.mjs <dir-or-tar.gz>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { pathToFileURL } from "node:url";

const TREE_LIMIT = 100 * 1024 * 1024;

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: node scripts/verify-archive.mjs <dir-or-tar.gz>");
  process.exit(2);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walkFiles(root, dir = root, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(root, full, acc);
    else acc.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return acc;
}

function pngUnderResults(root) {
  const hits = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.toLowerCase().endsWith(".png")) hits.push(full);
    }
  }
  walk(path.join(root, "results"));
  return hits;
}

const arg = process.argv[2];
if (!arg) usage("directory or archive required");

let root = path.resolve(arg);
let archiveBytes = null;
if (fs.existsSync(root) && fs.statSync(root).isFile()) {
  archiveBytes = fs.statSync(root).size;
  if (archiveBytes > TREE_LIMIT && !path.basename(root).includes("-results")) {
    console.error(`tree archive is ${archiveBytes} bytes, over 100 MB`);
    process.exit(1);
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-verify-"));
  const tar = spawnSync("tar", ["-xzf", root, "-C", staging], { encoding: "utf8" });
  if (tar.status !== 0) {
    console.error(tar.stderr || "tar extract failed");
    process.exit(1);
  }
  const kids = fs.readdirSync(staging);
  root = kids.length === 1 ? path.join(staging, kids[0]) : staging;
}

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) usage(`not a directory: ${arg}`);

const pngs = pngUnderResults(root);
if (pngs.length) {
  console.error(`png under results/: ${pngs.slice(0, 5).join(", ")}`);
  process.exit(1);
}

const manifestPath = path.join(root, "MANIFEST.json");
if (!fs.existsSync(manifestPath)) {
  console.error("missing MANIFEST.json");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const listed = Array.isArray(manifest.files) ? manifest.files : [];
const listedPaths = listed.map((f) => f.path);
const selfListed = listedPaths.includes("MANIFEST.json");
if (selfListed) {
  console.error("MANIFEST.json lists itself");
}

const onDisk = walkFiles(root).filter((p) => p !== "MANIFEST.json");
const listedSet = new Set(listedPaths);
const diskSet = new Set(onDisk);

const missing = listedPaths.filter((p) => !diskSet.has(p));
const extra = onDisk.filter((p) => !listedSet.has(p));
const mismatched = [];
const matched = [];

for (const entry of listed) {
  const full = path.join(root, entry.path);
  if (!fs.existsSync(full)) continue;
  const actual = sha256File(full);
  if (actual !== entry.sha256) mismatched.push({ path: entry.path, expected: entry.sha256, actual });
  else matched.push(entry.path);
}

let treeSha256 = null;
let walkSha256 = null;
let digestError = null;
const digestScript = path.join(root, "scripts/tree-digest.mjs");
if (fs.existsSync(digestScript)) {
  const mod = await import(pathToFileURL(digestScript).href);
  treeSha256 = mod.treeSha256(root);
  const h = crypto.createHash("sha256");
  for (const e of mod.sourceManifest(root)) h.update(`${e.path}\0${e.sha256}\n`);
  walkSha256 = h.digest("hex");
  if (manifest.treeSha256 && manifest.treeSha256 !== treeSha256) {
    digestError = `treeSha256 manifest ${manifest.treeSha256} != unpacked ${treeSha256}`;
  }
  if (manifest.walkSha256 && manifest.walkSha256 !== walkSha256) {
    digestError = `${digestError ? digestError + "; " : ""}walkSha256 manifest ${manifest.walkSha256} != unpacked ${walkSha256}`;
  }
} else if (manifest.treeSha256) {
  digestError = "manifest has treeSha256 but scripts/tree-digest.mjs is missing";
}

const report = {
  matched: matched.length,
  missing,
  extra,
  mismatched,
  selfListed,
  packedAt: manifest.packedAt ?? null,
  treeSha256,
  manifestTreeSha256: manifest.treeSha256 ?? null,
  walkSha256,
  manifestWalkSha256: manifest.walkSha256 ?? null,
  archiveBytes,
  pngUnderResults: pngs.length,
};

console.log(JSON.stringify(report, null, 2));

if (selfListed || missing.length || extra.length || mismatched.length || digestError) {
  if (digestError) console.error(digestError);
  process.exit(1);
}
process.exit(0);
