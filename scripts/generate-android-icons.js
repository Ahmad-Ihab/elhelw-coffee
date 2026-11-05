const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "app icon copy.png");
if (!fs.existsSync(sourcePath)) {
  throw new Error('Missing the uploaded launcher artwork: "app icon copy.png"');
}

const resRoot = path.join(root, "android", "app", "src", "main", "res");
const legacyDensities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
// Adaptive icons use a 108dp canvas. Keep the complete artwork inset so the
// system's launcher mask/shadow cannot cut off the designed outer frame.
const adaptiveDensities = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const MASTER_SIZE = 1024;
const ARTWORK_SIZE = 860;

async function main() {
  const metadata = await sharp(sourcePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("The uploaded app icon image could not be read.");
  }

  // Preserve the original aspect ratio and every pixel of the Photoshop artwork.
  // Add transparent breathing room instead of using 'cover' (which crops edges).
  const artwork = await sharp(sourcePath)
    .resize(ARTWORK_SIZE, ARTWORK_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false
    })
    .png()
    .toBuffer();

  const master = await sharp({
    create: {
      width: MASTER_SIZE,
      height: MASTER_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: artwork, gravity: "centre" }])
    .png()
    .toBuffer();

  for (const [density, size] of Object.entries(legacyDensities)) {
    const dir = path.join(resRoot, `mipmap-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    const icon = sharp(master).resize(size, size, { fit: "contain" });
    await icon.clone().png().toFile(path.join(dir, "ic_launcher.png"));
    await icon.clone().png().toFile(path.join(dir, "ic_launcher_round.png"));
  }

  for (const [density, size] of Object.entries(adaptiveDensities)) {
    const dir = path.join(resRoot, `mipmap-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    await sharp(master).resize(size, size, { fit: "contain" })
      .png().toFile(path.join(dir, "ic_launcher_foreground.png"));
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
  fs.writeFileSync(path.join(adaptiveDir, "ic_launcher_round.xml"), adaptiveXml, "utf8");

  const valuesDir = path.join(resRoot, "values");
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#F9A51A</color></resources>
`,
    "utf8"
  );
  console.log(`Generated high-resolution Android launcher icons from the original ${metadata.width}x${metadata.height} artwork with contain scaling and safe margins.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
