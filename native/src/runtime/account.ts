import { randomUUID } from "./crypto";
import { Buffer } from "buffer";
import { commitDocument, readDocument, type LocalAccount, type LocalDocument } from "./database";
import { emptyState, hydrate, snapshot } from "./codec";
import { keyString, parseKey, passwordKey, randomKey, seal, unseal } from "./encryption";
import { AuthenticationRequiredError } from "../../../src/lib/auth/errors";
import { saveLlmCredential } from "../../../src/lib/credentials";

declare const __NATIVE_DEFAULT_LLM__: { provider: string; apiKey: string; baseUrl: string; model: string };

let document: LocalDocument;
let active: { account: LocalAccount; key: Uint8Array } | null = null;
let tail: Promise<unknown> = Promise.resolve();
let pendingPath: string | null = null;
export function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const next = tail.then(operation, operation);
  tail = next.catch(() => {});
  return next;
}
export async function openLocalDatabase() { document = await readDocument(); }
export function localSession() {
  return active ? { userId: active.account.id, email: active.account.email, provider: "password" as const } : null;
}
export function requireLocalSession() {
  const session = localSession();
  if (!session) throw new AuthenticationRequiredError();
  return session;
}
export function setPendingPath(path: string) {
  pendingPath = path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/login") ? path : "/";
}
export function consumePendingPath() {
  const path = pendingPath ?? "/";
  pendingPath = null;
  return path;
}
function email(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("请输入有效的本地账户邮箱标识。");
  return normalized;
}
function activateAccount(account: LocalAccount, key: Uint8Array, state: unknown) {
  clearLocalSession();
  active = { account, key };
  process.env.USER_KEY_VAULT_SECRET = Buffer.from(key).toString("hex");
  process.env.DEV_MOCK_USER_EMAIL = account.email;
  hydrate(state);
}
async function installDefaultCredential(userId: string) {
  if (typeof __NATIVE_DEFAULT_LLM__ === "undefined") return;
  const config = __NATIVE_DEFAULT_LLM__;
  if (config.provider !== "compatible" || !config.apiKey || !config.baseUrl || !config.model) return;
  const store = globalThis as typeof globalThis & { renewalCredentialStore?: Map<string, unknown> };
  if (store.renewalCredentialStore?.has(userId)) return;
  await saveLlmCredential(userId, { provider: "compatible", apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model });
  await persistActiveState();
}
export function clearLocalSession() {
  active?.key.fill(0);
  active = null;
  delete process.env.USER_KEY_VAULT_SECRET;
  hydrate(emptyState());
}
export async function registerLocalAccount(address: string, password: string) {
  const normalized = email(address);
  if (document.accounts.some(account => account.email === normalized)) throw new Error("该本地账户已存在，请登录。");
  const id = randomUUID();
  const salt = keyString(randomKey());
  const key = randomKey();
  const recovery = randomKey();
  const account: LocalAccount = {
    id, email: normalized, salt,
    wrappedKey: await seal(keyString(key), await passwordKey(password, salt), id),
    recoveryWrappedKey: await seal(keyString(key), recovery, id),
    state: await seal(emptyState(), key, `${id}:state:1`)
  };
  const next = { ...document, accounts: [...document.accounts, account] };
  await commitDocument(next);
  document = next;
  activateAccount(account, key, emptyState());
  await installDefaultCredential(id);
  return keyString(recovery);
}
let failures = 0;
let retryAfter = 0;
export async function loginLocalAccount(address: string, password: string) {
  if (Date.now() < retryAfter) throw new Error("尝试过于频繁，请稍后再试。");
  const account = document.accounts.find(item => item.email === email(address));
  try {
    // Derive even for unknown accounts. Password recovery never discards the existing vault key.
    const derived = await passwordKey(password, account?.salt ?? keyString(new Uint8Array(32)));
    if (!account) throw new Error();
    const key = parseKey(await unseal<string>(account.wrappedKey, derived, account.id));
    const state = await unseal(account.state, key, `${account.id}:state:1`);
    activateAccount(account, key, state);
    await installDefaultCredential(account.id);
    failures = 0;
  } catch {
    if (!active || active.account.id !== account?.id) {
      retryAfter = Date.now() + Math.min(30000, ++failures * 500);
      throw new Error("账户或密码不正确，或本地数据未能解锁。");
    }
    throw new Error("默认模型配置未能保存，请重新打开设置页重试。");
  }
}
export async function recoverLocalAccount(address: string, recovery: string, password: string) {
  const account = document.accounts.find(item => item.email === email(address));
  if (!account) throw new Error("恢复信息不正确。");
  let wrapped: string;
  try { wrapped = await unseal<string>(account.recoveryWrappedKey, parseKey(recovery.trim()), account.id); }
  catch { throw new Error("恢复信息不正确。"); }
  const salt = keyString(randomKey());
  const updated = { ...account, salt, wrappedKey: await seal(wrapped, await passwordKey(password, salt), account.id) };
  const next = { ...document, accounts: document.accounts.map(item => item.id === account.id ? updated : item) };
  await commitDocument(next);
  document = next;
  clearLocalSession();
}
export async function persistActiveState() {
  if (!active) return;
  const updated = { ...active.account, state: await seal(snapshot(), active.key, `${active.account.id}:state:1`) };
  const next = { ...document, accounts: document.accounts.map(item => item.id === updated.id ? updated : item) };
  await commitDocument(next);
  document = next;
  active.account = updated;
}
export async function reloadActiveState() {
  if (active) hydrate(await unseal(active.account.state, active.key, `${active.account.id}:state:1`));
}
export async function deleteLocalAccount() {
  const session = requireLocalSession();
  const next = { ...document, accounts: document.accounts.filter(item => item.id !== session.userId) };
  await commitDocument(next);
  document = next;
  clearLocalSession();
}
