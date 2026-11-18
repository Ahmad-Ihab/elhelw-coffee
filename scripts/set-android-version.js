const fs = require("node:fs");

const version = require("../android-version.json");
const gradlePath = "android/app/build.gradle";
const lines = fs.readFileSync(gradlePath, "utf8").split("\n");
let codeUpdated = false;
let nameUpdated = false;

const updated = lines.map(line => {
  const trimmed = line.trim();
  if (trimmed.startsWith("versionCode ")) {
    codeUpdated = true;
    return line.slice(0, line.indexOf("versionCode")) + "versionCode " + version.versionCode;
  }
  if (trimmed.startsWith("versionName ")) {
    nameUpdated = true;
    return line.slice(0, line.indexOf("versionName")) + 'versionName "' + version.versionName + '"';
  }
  return line;
});

if (!codeUpdated || !nameUpdated) {
  throw new Error("Could not find Android versionCode/versionName in generated Gradle file");
}

fs.writeFileSync(gradlePath, updated.join("\n"), "utf8");
console.log("Android version " + version.versionName + " (" + version.versionCode + ")");
