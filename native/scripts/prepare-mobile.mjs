import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const path = fileURLToPath(new URL("../src-tauri/gen/android/app/src/main/AndroidManifest.xml", import.meta.url));
if (!existsSync(path)) {
  console.error("Run npm --prefix native run android:init first, then rerun this permission setup.");
  process.exit(1);
}
let manifest = readFileSync(path, "utf8");

// wry 处理 WebView 的 AUDIO_CAPTURE 时会同时申请 RECORD_AUDIO 和
// MODIFY_AUDIO_SETTINGS，并且要求两者全部授予才放行；只声明前者会让
// getUserMedia 在所有设备上失败。MODIFY_AUDIO_SETTINGS 是 normal 权限，
// 安装即授予，不会弹窗。
const requiredPermissions = [
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS"
];

for (const permission of requiredPermissions) {
  if (manifest.includes(permission)) continue;
  manifest = manifest.replace(
    /<application\b/,
    `<uses-permission android:name="${permission}" />\n    <application`
  );
  writeFileSync(path, manifest);
}

console.log(
  "Android microphone permissions are declared (RECORD_AUDIO, MODIFY_AUDIO_SETTINGS). Runtime recording permission still requires device verification."
);

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
