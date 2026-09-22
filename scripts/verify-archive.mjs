#!/usr/bin/env node
/**
 * Recompute SHA-256 of every payload file listed in MANIFEST.json.
 * MANIFEST.json must not list itself. Exits non-zero on missing, extra, or mismatched.
 *
 * Usage: node scripts/verify-archive.mjs <dir>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: node scripts/verify-archive.mjs <dir>");
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

const dir = process.argv[2];
if (!dir) usage("directory required");
const root = path.resolve(dir);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) usage(`not a directory: ${dir}`);

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

const report = {
  matched: matched.length,
  missing,
  extra,
  mismatched,
  selfListed,
  packedAt: manifest.packedAt ?? null,
};

console.log(JSON.stringify(report, null, 2));

if (selfListed || missing.length || extra.length || mismatched.length) process.exit(1);
process.exit(0);
