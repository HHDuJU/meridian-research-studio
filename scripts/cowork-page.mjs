#!/usr/bin/env node
/**
 * Meridian on Cowork: write the artifact page that loads the Cowork build.
 *
 *   npm run build:cowork   (vite build --config vite.cowork.config.ts, then this script)
 *
 * The Artifact tool wraps a page in its own document skeleton, so the page carries no doctype, html,
 * head or body of its own: a title, the stylesheet, the mount point and the script. app.js and app.css
 * are published next to it as supporting files (relative paths).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] || "dist-cowork");
const js = path.join(dir, "app.js");
const css = path.join(dir, "app.css");
for (const f of [js, css]) {
  if (!fs.existsSync(f)) {
    console.error(`missing ${f}: run vite build --config vite.cowork.config.ts first`);
    process.exit(1);
  }
}
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const page = `<title>Meridian Research Studio</title>
<link rel="stylesheet" href="app.css">
<div id="meridian-root"></div>
<noscript>Meridian needs JavaScript to run.</noscript>
<script src="app.js"></script>
`;
fs.writeFileSync(path.join(dir, "meridian.html"), page);
const manifest = {
  page: "meridian.html",
  files: {
    "app.js": { bytes: fs.statSync(js).size, sha256: sha(js) },
    "app.css": { bytes: fs.statSync(css).size, sha256: sha(css) },
  },
};
fs.writeFileSync(path.join(dir, "cowork-build.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
