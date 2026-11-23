import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const path = fileURLToPath(new URL("../src-tauri/gen/android/app/src/main/AndroidManifest.xml", import.meta.url));
if (!existsSync(path)) {
  console.error("Run npm --prefix native run android:init first, then rerun this permission setup.");
  process.exit(1);
}
let manifest = readFileSync(path, "utf8");
if (!manifest.includes("android.permission.RECORD_AUDIO")) {
  manifest = manifest.replace(/<application\b/, '<uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <application');
  writeFileSync(path, manifest);
}
console.log("Android microphone permission is declared. Runtime recording permission still requires device verification.");

// Reapply canonical launcher resources after Tauri staging as well as initialization.
const iconRoot = fileURLToPath(new URL("../src-tauri/icons/android/", import.meta.url));
const resourceRoot = fileURLToPath(new URL("../src-tauri/gen/android/app/src/main/res/", import.meta.url));
for (const folder of readdirSync(iconRoot)) {
  const source = join(iconRoot, folder);
  if (!statSync(source).isDirectory()) continue;
  const destination = join(resourceRoot, folder);
  // Older manual staging accidentally created a file named mipmap-anydpi-v26.
  if (existsSync(destination) && statSync(destination).isFile()) unlinkSync(destination);
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source)) copyFileSync(join(source, name), join(destination, name));
}
console.log("Canonical Android launcher resources staged.");

const gradlePath = fileURLToPath(new URL("../src-tauri/gen/android/app/build.gradle.kts", import.meta.url));
if (existsSync(gradlePath)) {
  const gradle = readFileSync(gradlePath, "utf8").replace(/compileSdk = \d+/, "compileSdk = 36").replace(/targetSdk = \d+/, "targetSdk = 36");
  writeFileSync(gradlePath, gradle);
  console.log("Pinned Android SDK to installed stable API 36.");
}
