const fs = require("node:fs");
const path = require("node:path");

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

console.log("Web assets prepared in www/");
