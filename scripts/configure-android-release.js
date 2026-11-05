const fs = require("node:fs");
const path = require("node:path");

const required = [
  "ANDROID_KEYSTORE_PATH",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD"
];
for (const name of required) {
  if (!process.env[name]) throw new Error("Missing required release signing environment variable: " + name);
}

const gradlePath = path.resolve(__dirname, "..", "android", "app", "build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");

if (!gradle.includes("buildTypes {")) {
  throw new Error("Could not locate buildTypes block in generated Android app/build.gradle");
}
if (gradle.includes("signingConfigs {")) {
  throw new Error("Signing configuration already exists; refusing to modify Gradle file twice.");
}

const signingBlock = `signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }

    `;
gradle = gradle.replace("buildTypes {", signingBlock + "buildTypes {");

const buildTypesIndex = gradle.indexOf("buildTypes {");
const releaseIndex = gradle.indexOf("release {", buildTypesIndex);
if (releaseIndex < 0) throw new Error("Could not locate release build type.");
const insertion = releaseIndex + "release {".length;
gradle = gradle.slice(0, insertion) + "\n            signingConfig signingConfigs.release" + gradle.slice(insertion);

fs.writeFileSync(gradlePath, gradle, "utf8");
console.log("Configured signed Android release build.");
