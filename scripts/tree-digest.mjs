#!/usr/bin/env node
/**
 * Pinned source-tree digest used by the scenario runner (`treeSha256`) and by pack-archive.
 * Walk and skip rules are the single definition both tools use.
 *
 * Digest: SHA-256 of sorted `path\\0sha256\\n` lines (payload file hashes, not archive bytes).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".output",
  ".nitro",
  ".tanstack",
  ".vite",
  ".vercel",
  "dist",
  "artifacts",
  "attachments",
  "screenshots",
  ".cache",
]);

/** Digest-only skips so installing the bank under scenarios/ does not move treeSha256 (A4.1 R-5). */
export const DIGEST_SKIP_DIRS = new Set(["scenarios", "results"]);

export function skipFile(rel) {
  if (rel.startsWith(".vercel/") || rel === ".vercel") return true;
  if (rel.startsWith("public/artifacts/") && /\.tar\.gz/.test(rel)) return true;
  if (rel.endsWith(".tar.gz") || rel.endsWith(".tar.gz.bin") || rel.endsWith(".tar.gz.sha256")) return true;
  if (rel === ".env") return true;
  if (rel === "MANIFEST.json") return true;
  return false;
}

/** P5: pinned digest is an allowlist of product source. Agent state, docs, scenarios, results, public assets and MANIFEST are outside it. */
export const PINNED_DIRS = ["src", "server", "scripts", "tests", "probes", "migrations"];
export const PINNED_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "eslint.config.mjs",
  "startup.sh",
  ".env.example",
];

export function walkSourceTree(root, opts = {}) {
  const digest = !!opts.digest;
  const acc = [];
  if (digest) {
    for (const file of PINNED_FILES) {
      const full = path.join(root, file);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) acc.push(file);
    }
    function walkPinned(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        const full = path.join(dir, ent.name);
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (ent.isDirectory()) walkPinned(full);
        else if (!skipFile(rel)) acc.push(rel);
      }
    }
    for (const dir of PINNED_DIRS) {
      const full = path.join(root, dir);
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) walkPinned(full);
    }
    return acc.sort();
  }
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(ent.name)) continue;
      if (ent.name === "results" && dir === root) continue;
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (ent.isDirectory()) walk(full);
      else if (!skipFile(rel)) acc.push(rel);
    }
  }
  walk(root);
  return acc.sort();
}

export function sourceManifest(root, opts = {}) {
  return walkSourceTree(root, opts).map((rel) => {
    const buf = fs.readFileSync(path.join(root, rel));
    return {
      path: rel,
      bytes: buf.length,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    };
  });
}

/** SHA-256 hex of the pinned source manifest (sorted path + file hash lines). */
export function treeSha256(root) {
  const h = crypto.createHash("sha256");
  for (const e of sourceManifest(root, { digest: true })) {
    h.update(`${e.path}\0${e.sha256}\n`);
  }
  return h.digest("hex");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = path.resolve(process.argv[2] || ".");
  const digest = treeSha256(root);
  const files = walkSourceTree(root);
  console.log(JSON.stringify({ root, treeSha256: digest, fileCount: files.length }, null, 2));
}
