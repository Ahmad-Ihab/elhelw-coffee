const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "www");
const files = ["index.html", "app.js", "styles.css", "config.js"];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}

const assetsSource = path.join(root, "assets");
const assetsTarget = path.join(out, "assets");
fs.cpSync(assetsSource, assetsTarget, { recursive: true });

// Build Capacitor Filesystem + Share into a local browser bundle.
// Never fetch these modules at runtime inside Android WebView.
execFileSync("npx", [
  "--yes",
  "esbuild@0.25.5",
  "scripts/pdf-plugins.js",
  "--bundle",
  "--platform=browser",
  "--format=iife",
  "--outfile=www/pdf-plugins.js"
], { cwd: root, stdio: "inherit" });

console.log("Web assets and local Capacitor PDF plugins prepared in www/");
