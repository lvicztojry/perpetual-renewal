import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function compareVersions(a, b) {
  function parse(value) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
    if (!match || match[4]?.split(".").some(part => !part || /^0\d+$/.test(part))) throw new Error("Invalid release version.");
    return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split(".") };
  }
  const left = parse(a), right = parse(b);
  for (let index = 0; index < 3; index++) if (left.core[index] !== right.core[index]) return left.core[index] > right.core[index] ? 1 : -1;
  if (!left.pre || !right.pre) return left.pre ? -1 : right.pre ? 1 : 0;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index++) {
    const x = left.pre[index], y = right.pre[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numericX = /^\d+$/.test(x), numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
export function assertCompatibleUpdate(current, previous) {
  if (current.productName !== previous.productName) throw new Error("Installer product identity changed.");
  if (!(current.androidVersionCode > previous.androidVersionCode) || !(current.iosBuildNumber > previous.iosBuildNumber)) throw new Error("Mobile build numbers must increase.");
  if (current.applicationId !== previous.applicationId) throw new Error("Application identity changed; this would create a different data directory.");
  if (compareVersions(current.version, previous.version) <= 0) throw new Error("Updates require a newer application version.");
  if (current.dataFormat !== previous.dataFormat) throw new Error("Encrypted payload format changes require an explicit converter; automatic update refused.");
  if (current.dataSchema < previous.dataSchema) throw new Error("Database downgrade refused.");
  for (const old of previous.migrations) {
    if (!current.migrations.some(item => item.path === old.path && item.sha256 === old.sha256)) throw new Error("Previously published migration was changed or removed.");
  }
}

function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = JSON.parse(readFileSync(join(root, "native/src-tauri/tauri.conf.json")));
  const policy = JSON.parse(readFileSync(join(root, "native/release-policy.json")));
  const pkg = JSON.parse(readFileSync(join(root, "native/package.json")));
  const rust = readFileSync(join(root, "native/src-tauri/src/lib.rs"), "utf8");
  if (config.identifier !== policy.applicationId || config.productName !== policy.productName || config.bundle.android.versionCode !== policy.androidVersionCode || Number(config.bundle.iOS.bundleVersion) !== policy.iosBuildNumber || pkg.version !== config.version || Number(rust.match(/const SCHEMA_VERSION: i64 = (\d+)/)?.[1]) !== policy.dataSchema) throw new Error("Native identity/version/schema policy is inconsistent.");
  compareVersions(pkg.version, pkg.version);
  const dist = join(root, "dist"); mkdirSync(dist, { recursive: true });
  const stage = mkdtempSync(join(dist, "native-source-"));
  const files = [];
  function copy(path) {
    const input = join(root, path), stat = lstatSync(input);
    if (stat.isSymbolicLink()) throw new Error("Refusing links in release source.");
    if (stat.isDirectory()) { for (const name of readdirSync(input).sort()) copy(join(path, name)); return; }
    if (/(^|[\\/])\.env|\.(?:pem|key|log|db|sqlite3?|dump|bak)$/i.test(path)) throw new Error("Refusing private data in source release.");
    const output = join(stage, path); mkdirSync(dirname(output), { recursive: true }); copyFileSync(input, output);
    files.push({ path: path.replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(input)).digest("hex") });
  }
  try {
    for (const input of ["package.json", "package-lock.json", "tsconfig.json", "prisma/schema.prisma", "scripts/prisma-command.mjs", "scripts/database-url.mjs", "scripts/load-local-env.mjs", "tests/native-local-storage.mjs", "tests/native-local-browser.mjs", "tests/native-release-policy.mjs", "src", "public", "native/package.json", "native/package-lock.json", "native/tsconfig.json", "native/index.html", "native/vite.config.ts", "native/release-policy.json", "native/src", "native/migrations", "native/scripts", "native/src-tauri/Cargo.toml", "native/src-tauri/build.rs", "native/src-tauri/tauri.conf.json", "native/src-tauri/Info.plist", "native/src-tauri/capabilities", "native/src-tauri/icons", "native/src-tauri/src", "scripts/prepare-native.mjs", "docs/LOCAL_CLIENTS.md"]) copy(input);
    if (existsSync(join(root, "native/src-tauri/Cargo.lock"))) copy("native/src-tauri/Cargo.lock");
    const release = { kind: "source-preparation-not-an-installer", version: pkg.version, ...policy, platforms: ["windows", "macos", "android", "ios"], migrations: files.filter(item => item.path.startsWith("native/migrations/")), files };
    const args = process.argv.slice(2), previousIndex = args.indexOf("--previous");
    if (previousIndex !== -1) assertCompatibleUpdate(release, JSON.parse(readFileSync(args[previousIndex + 1], "utf8")));
    writeFileSync(join(stage, "RELEASE.json"), JSON.stringify(release, null, 2) + "\n");
    copyFileSync(join(root, "docs/LOCAL_CLIENTS.md"), join(stage, "README.md"));
    const artifact = join(dist, `renewal-local-source-${pkg.version}.tar.gz`);
    const result = spawnSync("tar", ["-czf", artifact, "-C", stage, "."], { windowsHide: true, encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error("Source archive creation failed.");
    writeFileSync(join(dist, `renewal-local-source-${pkg.version}.release.json`), JSON.stringify(release, null, 2) + "\n");
    console.log(`Native source prepared: ${artifact}; ${files.length} file hashes. Platform build/signing/device checks are still required.`);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
