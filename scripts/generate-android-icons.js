const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const svgPath = path.join(root, "assets", "app-icon.svg");
const svg = fs.readFileSync(svgPath, "utf8");
const pathData = (svg.match(/<path[^>]*d="([^"]+)"/) || [])[1];
if (!pathData) throw new Error("Could not find the logo path in assets/app-icon.svg");

const resRoot = path.join(root, "android", "app", "src", "main", "res");
const densities = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const foregroundSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
  '<g transform="translate(102 151) scale(0.34)"><path fill="#fff" fill-rule="evenodd" d="' +
  pathData +
  '"/></g></svg>'
);

async function main() {
  for (const [density, size] of Object.entries(densities)) {
    const dir = path.join(resRoot, `mipmap-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    const regular = sharp(Buffer.from(svg)).resize(size, size);
    await regular.png().toFile(path.join(dir, "ic_launcher.png"));
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(dir, "ic_launcher_round.png"));
    await sharp(foregroundSvg).resize(size, size).png().toFile(path.join(dir, "ic_launcher_foreground.png"));
  }

  const adaptiveDir = path.join(resRoot, "mipmap-anydpi-v26");
  fs.mkdirSync(adaptiveDir, { recursive: true });
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
  fs.writeFileSync(path.join(adaptiveDir, "ic_launcher.xml"), adaptiveXml, "utf8");
  const valuesDir = path.join(resRoot, "values");
  fs.mkdirSync(valuesDir, { recursive: true });
  const colorsPath = path.join(valuesDir, "ic_launcher_background.xml");
  fs.writeFileSync(colorsPath, `<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#F9A51A</color></resources>
`, "utf8");
  console.log("Generated Elhelw launcher icons for all Android densities.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
