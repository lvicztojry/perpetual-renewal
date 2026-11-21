import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
