import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(new URL("../native/package.json", import.meta.url));
async function load(file) {
  let source = ts.transpileModule(readFileSync(join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  source = source.replace(/from "(@noble\/[^"]+)"/g, (_, specifier) => `from "${pathToFileURL(nativeRequire.resolve(specifier)).href}"`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
const local = await load("native/src/runtime/crypto.ts");
for (const value of ["hello", "本地 Key 🔐", Buffer.from([0, 1, 255])]) {
  assert.equal(local.createHash("sha256").update(value).digest("hex"), createHash("sha256").update(value).digest("hex"));
  assert.equal(local.createHmac("sha256", "fixture-hmac").update(value).digest("hex"), createHmac("sha256", "fixture-hmac").update(value).digest("hex"));
}
const key = Buffer.alloc(32, 7), iv = Buffer.alloc(12, 8);
const nativeCipher = local.createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([nativeCipher.update("fixture-api-key", "utf8"), nativeCipher.final()]);
const nodeDecipher = createDecipheriv("aes-256-gcm", key, iv);
nodeDecipher.setAuthTag(nativeCipher.getAuthTag());
assert.equal(Buffer.concat([nodeDecipher.update(encrypted), nodeDecipher.final()]).toString(), "fixture-api-key");
const nodeCipher = createCipheriv("aes-256-gcm", key, iv);
const nodeEncrypted = Buffer.concat([nodeCipher.update("fixture-existing-vault"), nodeCipher.final()]);
const localDecipher = local.createDecipheriv("aes-256-gcm", key, iv);
localDecipher.setAuthTag(nodeCipher.getAuthTag());
assert.equal(Buffer.concat([localDecipher.update(nodeEncrypted), localDecipher.final()]).toString(), "fixture-existing-vault");
const tampered = local.createDecipheriv("aes-256-gcm", key, iv);
tampered.setAuthTag(Buffer.alloc(16)); tampered.update(nodeEncrypted);
assert.throws(() => tampered.final());
const encryption = await load("native/src/runtime/encryption.ts");
const salt = encryption.keyString(encryption.randomKey());
const passwordKey = await encryption.passwordKey("fixture-account-password", salt);
assert.deepEqual(await encryption.passwordKey("fixture-account-password", salt, true), passwordKey, "portable webview KDF must preserve existing keys");
const sealed = await encryption.seal({ value: "private fixture" }, passwordKey, "account-a");
assert.deepEqual(await encryption.unseal(sealed, passwordKey, "account-a"), { value: "private fixture" });
await assert.rejects(encryption.unseal(sealed, passwordKey, "account-b"));
await assert.rejects(encryption.unseal(sealed, encryption.randomKey(), "account-a"));

const parent = join(root, ".tmp-native-qa"); mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(join(parent, "sqlite-"));
let db, second;
try {
  const path = join(folder, "state.sqlite3");
  db = new DatabaseSync(path);
  db.exec(readFileSync(join(root, "native/migrations/0001_local_state.sql"), "utf8"));
  db.exec("PRAGMA user_version=1");
  const body = JSON.stringify({ format: 1, accounts: [{ id: "fixture", state: sealed }] });
  const update = "UPDATE local_document SET body=?, revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?";
  assert.equal(db.prepare(update).run(body, 0).changes, 1);
  second = new DatabaseSync(path);
  assert.equal(second.prepare(update).run('{"format":1,"accounts":[]}', 0).changes, 0, "stale app cannot overwrite persisted data");
  const backup = join(folder, "before-update.sqlite3");
  db.prepare("VACUUM INTO ?").run(backup);
  db.exec("BEGIN IMMEDIATE");
  db.exec("ALTER TABLE local_document ADD COLUMN fixture_upgrade TEXT NOT NULL DEFAULT 'v2'");
  db.exec("PRAGMA user_version=2; COMMIT");
  assert.equal(db.prepare("SELECT body FROM local_document").get().body, body, "app/account payload is preserved across a schema update");
  db.exec("BEGIN IMMEDIATE");
  assert.throws(() => db.exec("ALTER TABLE local_document ADD COLUMN should_rollback TEXT; INVALID MIGRATION;"));
  db.exec("ROLLBACK");
  assert(!db.prepare("PRAGMA table_info(local_document)").all().some(column => column.name === "should_rollback"));
  assert.equal(db.prepare("SELECT body FROM local_document").get().body, body);
  second.close(); second = new DatabaseSync(backup, { readOnly: true });
  assert.equal(second.prepare("PRAGMA user_version").get().user_version, 1);
  assert.equal(second.prepare("SELECT body FROM local_document").get().body, body);
  assert.equal(second.prepare("PRAGMA quick_check").get().quick_check, "ok");
} finally {
  db?.close(); second?.close(); rmSync(folder, { recursive: true, force: true });
}
console.log("Native storage contracts passed: Node/browser crypto interoperability, authenticated encryption, real SQLite schema update, backup readability, transaction rollback and stale-write rejection. Rust bridge/device tests remain separate.");
