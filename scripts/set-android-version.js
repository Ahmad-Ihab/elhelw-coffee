const fs = require("node:fs");

const version = require("../android-version.json");
const gradlePath = "android/app/build.gradle";
let gradle = fs.readFileSync(gradlePath, "utf8");

gradle = gradle.replace(/versionCode\s+\\d+/, "versionCode " + version.versionCode);
gradle = gradle.replace(/versionName\s+"[^"]+"/, 'versionName "' + version.versionName + '"');

if (!gradle.includes("versionCode " + version.versionCode) ||
    !gradle.includes('versionName "' + version.versionName + '"')) {
  throw new Error("Failed to apply Android version from android-version.json");
}

fs.writeFileSync(gradlePath, gradle, "utf8");
console.log("Android version " + version.versionName + " (" + version.versionCode + ")");
