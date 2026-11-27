const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "www");
const files = ["index.html", "app.js", "styles.css", "config.js", "production-calculator.js", "procurement.js", "erp-workspace.js", "interface.css", "illustrations.js", "production-calculator.css", "sw.js", "manifest.webmanifest"];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}

// Ship login and invoice rendering inside the APK, including when a CDN is unavailable.
const bundledScripts = [
  ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", "@supabase/supabase-js/dist/umd/supabase.js", "supabase.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js", "html2pdf.js/dist/html2pdf.bundle.min.js", "html2pdf.js"]
];
const indexPath = path.join(out, "index.html");
let index = fs.readFileSync(indexPath, "utf8");
for (const [url, source, filename] of bundledScripts) {
  if (!index.includes(url)) throw new Error("Missing script tag for " + filename);
  fs.copyFileSync(path.join(root, "node_modules", source), path.join(out, filename));
  index = index.replace(url, "./" + filename);
}
fs.writeFileSync(indexPath, index);
const supabaseUmd = path.join(root, "node_modules/@supabase/supabase-js/dist/umd");
for (const file of fs.readdirSync(supabaseUmd).filter(file => /^\d+\.supabase\.js$/.test(file))) {
  fs.copyFileSync(path.join(supabaseUmd, file), path.join(out, file));
}

const calculatorSource = path.join(root, "production-calculator");
const calculatorTarget = path.join(out, "production-calculator");
fs.cpSync(calculatorSource, calculatorTarget, { recursive: true });

const assetsSource = path.join(root, "assets");
const assetsTarget = path.join(out, "assets");
fs.cpSync(assetsSource, assetsTarget, { recursive: true });

const fontsTarget = path.join(assetsTarget, "fonts");
const fontSource = path.join(root, "node_modules/@fontsource-variable/cairo");
fs.mkdirSync(fontsTarget, {recursive:true});
for (const script of ["arabic","latin"]) {
  fs.copyFileSync(path.join(fontSource,"files","cairo-"+script+"-wght-normal.woff2"),path.join(fontsTarget,"cairo-"+script+".woff2"));
}
fs.copyFileSync(path.join(fontSource,"LICENSE"),path.join(fontsTarget,"Cairo-LICENSE.txt"));

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

console.log("Web assets, bundled production calculator, service worker, and local Capacitor PDF plugins prepared in www/");
