import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Sealed } from "./encryption";

declare const __BROWSER_TEST__: boolean;
export type LocalAccount = { id: string; email: string; salt: string; wrappedKey: Sealed; recoveryWrappedKey: Sealed; state: Sealed };
export type LocalDocument = { format: 1; accounts: LocalAccount[] };
type Stored = { revision: number; body: string };
let current: Stored;

// Deliberately unavailable in production. This is a persistent browser QA adapter, not a native SQLite claim.
async function browserDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("renewal-native-qa", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("document");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(new Error("Browser QA database unavailable."));
  });
}
async function browserRead(): Promise<Stored> {
  const db = await browserDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("document", "readonly");
      const request = tx.objectStore("document").get("state");
      tx.oncomplete = () => resolve(request.result ?? { revision: 0, body: '{"format":1,"accounts":[]}' });
      tx.onerror = () => reject(new Error("Browser QA read failed."));
    });
  } finally { db.close(); }
}
async function browserCommit(body: string, expected: number): Promise<number> {
  const db = await browserDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("document", "readwrite");
      const store = tx.objectStore("document");
      const request = store.get("state");
      request.onsuccess = () => {
        if ((request.result?.revision ?? 0) !== expected) { tx.abort(); return; }
        store.put({ revision: expected + 1, body }, "state");
      };
      tx.oncomplete = () => resolve(expected + 1);
      tx.onabort = tx.onerror = () => reject(new Error("Local database conflict or write failure."));
    });
  } finally { db.close(); }
}
export async function readDocument(): Promise<LocalDocument> {
  if (!isTauri() && !__BROWSER_TEST__) throw new Error("请在已安装的本地应用中打开。浏览器不能代替原生数据存储。");
  current = isTauri() ? await invoke<Stored>("read_database") : await browserRead();
  const doc = JSON.parse(current.body) as LocalDocument;
  if (doc.format !== 1 || !Array.isArray(doc.accounts)) throw new Error("数据来自更新的版本，请安装兼容的应用，不能重置此数据库。");
  return doc;
}
export async function commitDocument(doc: LocalDocument) {
  const body = JSON.stringify(doc);
  const revision = isTauri() ? await invoke<number>("commit_database", { expectedRevision: current.revision, body }) : await browserCommit(body, current.revision);
  current = { revision, body };
}
export async function createBackup() {
  if (isTauri()) return invoke<string>("backup_database");
  if (!__BROWSER_TEST__) throw new Error("Native database required.");
  return "browser-qa-backup-only";
}
export const listBackups = async () => isTauri() ? invoke<string[]>("list_backups") : [];
export async function restoreBackup(name: string, confirmation: string) {
  if (!isTauri()) throw new Error("原生备份恢复需在安装版中验证。");
  await invoke("restore_backup", { name, confirmation });
}
