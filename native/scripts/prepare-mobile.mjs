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
}

// Android 11+ package visibility filters both probes and service discovery unless
// these actions appear under <queries>. A device may still have neither engine.
const requiredSpeechServices = [
  "android.speech.RecognitionService",
  "android.intent.action.TTS_SERVICE"
];
for (const action of requiredSpeechServices) {
  const queryBlocks = manifest.match(/<queries\b[^>]*>[\s\S]*?<\/queries\s*>/g) ?? [];
  if (queryBlocks.some((block) => new RegExp(`<action\\b[^>]*android:name\\s*=\\s*["']${action.replaceAll(".", "\\.")}["']`).test(block))) continue;
  const intent = `<intent><action android:name="${action}" /></intent>`;
  if (/<\/queries\s*>/.test(manifest)) {
    manifest = manifest.replace(/<\/queries\s*>/, `    ${intent}\n    </queries>`);
  } else if (/<queries\b[^>]*\/\s*>/.test(manifest)) {
    manifest = manifest.replace(/<queries\b[^>]*\/\s*>/, `<queries>\n        ${intent}\n    </queries>`);
  } else {
    manifest = manifest.replace(/<application\b/, `<queries>\n        ${intent}\n    </queries>\n    <application`);
  }
}
writeFileSync(path, manifest);

console.log(
  "Android microphone permissions and recognition/TTS service queries are declared. Engine availability and runtime permission still require device verification."
);

// 原生语音识别插件：Tauri 不会自动把应用自己的 Kotlin 插件编进工程，
// 这里复制到生成工程的应用包目录（与 MainActivity 同包）。
const speechSource = fileURLToPath(new URL("../android/SpeechPlugin.kt", import.meta.url));
if (existsSync(speechSource)) {
  const appPackageDir = fileURLToPath(
    new URL(
      "../src-tauri/gen/android/app/src/main/java/com/perpetualrenewal/localtest/",
      import.meta.url
    )
  );
  mkdirSync(appPackageDir, { recursive: true });
  copyFileSync(speechSource, join(appPackageDir, "SpeechPlugin.kt"));
  console.log("Android speech recognition and TextToSpeech plugin staged.");
}

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
