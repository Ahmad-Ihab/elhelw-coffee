const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
// This is the finished Photoshop launcher icon uploaded by the project owner.
const sourcePath = path.join(root, "app icon copy.png");
if (!fs.existsSync(sourcePath)) {
  throw new Error('Missing the uploaded launcher artwork: "app icon copy.png"');
}

const resRoot = path.join(root, "android", "app", "src", "main", "res");
const densities = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

async function main() {
  const source = sharp(sourcePath);
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("The uploaded app icon image could not be read.");
  }

  // Use the supplied finished artwork directly; do not redraw or replace its design.
  const master = await source
    .resize(512, 512, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  for (const [density, size] of Object.entries(densities)) {
    const dir = path.join(resRoot, `mipmap-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    const icon = sharp(master).resize(size, size);
    await icon.clone().png().toFile(path.join(dir, "ic_launcher.png"));
    await icon.clone().png().toFile(path.join(dir, "ic_launcher_round.png"));
    await icon.clone().png().toFile(path.join(dir, "ic_launcher_foreground.png"));
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
  console.log("Generated Android launcher icons from app icon copy.png.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
