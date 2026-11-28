import { Buffer } from "buffer";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
export type Sealed = { iv: string; data: string };
const utf8 = new TextEncoder();
const from64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));
export const randomKey = () => globalThis.crypto.getRandomValues(new Uint8Array(32));
export const keyString = (key: Uint8Array) => Buffer.from(key).toString("base64");
export const parseKey = (key: string) => from64(key);
export async function passwordKey(password: string, salt: string, portable = false) {
  if (password.length < 12 || password.length > 128) throw new Error("密码须为 12–128 个字符。");
  // Custom webview schemes may lack SubtleCrypto. Both implementations derive identical bytes.
  if (!portable && globalThis.crypto.subtle) {
    const source = await crypto.subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: from64(salt), iterations: 600000 }, source, 256));
  }
  return pbkdf2Async(sha256, utf8.encode(password), from64(salt), { c: 600000, dkLen: 32 });
}
export async function seal(value: unknown, key: Uint8Array, context: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = gcm(key, iv, utf8.encode(context)).encrypt(utf8.encode(JSON.stringify(value)));
  return { iv: keyString(iv), data: keyString(encrypted) };
}
export async function unseal<T>(value: Sealed, key: Uint8Array, context: string): Promise<T> {
  const decrypted = gcm(key, from64(value.iv), utf8.encode(context)).decrypt(from64(value.data));
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}
