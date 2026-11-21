import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const keyDirectory = join(root, ".release-keys/android");
const keyStore = join(keyDirectory, "signing.p12");
const credentialsPath = join(keyDirectory, "credentials.json");
const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const javaHome = process.env.JAVA_HOME;
if (!javaHome) throw new Error("Set JAVA_HOME using scripts/native-env.ps1 before signing.");
mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
if (existsSync(keyStore) && !existsSync(credentialsPath)) throw new Error("Signing credentials missing. Existing signing key was preserved.");
if (!existsSync(credentialsPath)) {
  writeFileSync(credentialsPath, JSON.stringify({ format: 1, alias: "renewal-local-test", password: randomBytes(32).toString("base64url"), createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
const env = { ...process.env, RENEWAL_ANDROID_STORE_PASSWORD: credentials.password };
if (!existsSync(keyStore)) {
  execFileSync(join(javaHome, "bin/keytool.exe"), ["-genkeypair", "-keystore", keyStore, "-storetype", "PKCS12", "-alias", credentials.alias, "-keyalg", "RSA", "-keysize", "3072", "-sigalg", "SHA256withRSA", "-validity", "10000", "-dname", "CN=Perpetual Renewal Local Test", "-storepass:env", "RENEWAL_ANDROID_STORE_PASSWORD", "-keypass:env", "RENEWAL_ANDROID_STORE_PASSWORD"], { env, stdio: "pipe", windowsHide: true });
}
if (args.includes("--init")) {
  console.log("Android signing identity prepared; private credentials are outside release artifacts.");
} else {
  const input = argument("--input"), output = argument("--output");
  if (!input || !output) throw new Error("Usage: node native/scripts/sign-android.mjs --input unsigned.apk --output signed.apk");
  const sdk = process.env.ANDROID_HOME || join(root, ".build-tools/android-sdk");
  const versions = readdirSync(join(sdk, "build-tools")).filter(name => /^\d+\.\d+\.\d+$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const tools = join(sdk, "build-tools", versions.at(-1));
  const aligned = join(root, ".tmp-native-build/signing", basename(output) + ".aligned.apk");
  mkdirSync(dirname(aligned), { recursive: true });
  mkdirSync(dirname(resolve(output)), { recursive: true });
  execFileSync(join(tools, "zipalign.exe"), ["-f", "-P", "16", "4", resolve(input), aligned], { stdio: "pipe", windowsHide: true });
  const jar = join(tools, "lib/apksigner.jar");
  execFileSync(join(javaHome, "bin/java.exe"), ["-jar", jar, "sign", "--v4-signing-enabled", "false", "--ks", keyStore, "--ks-key-alias", credentials.alias, "--ks-pass", "env:RENEWAL_ANDROID_STORE_PASSWORD", "--key-pass", "env:RENEWAL_ANDROID_STORE_PASSWORD", "--out", resolve(output), aligned], { env, stdio: "pipe", windowsHide: true });
  const result = execFileSync(join(javaHome, "bin/java.exe"), ["-jar", jar, "verify", "--verbose", "--print-certs", resolve(output)], { env, encoding: "utf8", windowsHide: true });
  console.log(result.split(/\r?\n/).filter(line => /Verified using|certificate SHA-256|Signer #1 certificate DN/.test(line)).join("\n"));
  rmSync(aligned);
  console.log(`Signed APK: ${resolve(output)}`);
}
