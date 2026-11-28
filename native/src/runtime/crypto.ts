// Browser/native implementation of the small Node crypto surface used by shared services.
import { Buffer } from "buffer";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { gcm } from "@noble/ciphers/aes.js";

const bytes = (value: string | Uint8Array, encoding?: BufferEncoding) => typeof value === "string" ? Buffer.from(value, encoding) : Buffer.from(value);
export function randomUUID() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const value = randomBytes(16);
  value[6] = (value[6] & 15) | 64; value[8] = (value[8] & 63) | 128;
  const hex = value.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
export function randomBytes(length: number) { return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(length))); }
export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) throw new Error("Length mismatch.");
  let result = 0;
  for (let index = 0; index < a.length; index++) result |= a[index] ^ b[index];
  return result === 0;
}
function hashFunction(name: string) {
  if (name === "sha256") return sha256;
  if (name === "sha512") return sha512;
  throw new Error("Unsupported digest.");
}
function digestBuilder(run: (input: Uint8Array) => Uint8Array) {
  const parts: Buffer[] = [];
  return {
    update(value: string | Uint8Array, encoding?: BufferEncoding) { parts.push(bytes(value, encoding)); return this; },
    digest(encoding?: BufferEncoding) { const result = Buffer.from(run(Buffer.concat(parts))); return encoding ? result.toString(encoding) : result; }
  };
}
export const createHash = (name: string) => digestBuilder(hashFunction(name));
export const createHmac = (name: string, key: string | Uint8Array) => digestBuilder(data => hmac(hashFunction(name), bytes(key), data));
export function scrypt(password: string, salt: Uint8Array, length: number, options: { N: number; r: number; p: number; maxmem: number }, callback: (error: Error | null, result?: Buffer) => void) {
  scryptAsync(password, salt, { ...options, dkLen: length }).then(value => callback(null, Buffer.from(value)), () => callback(new Error("Key derivation failed.")));
}
export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  if (algorithm !== "aes-256-gcm" || key.length !== 32) throw new Error("Unsupported cipher.");
  let tag: Buffer | undefined;
  return {
    update(value: string | Uint8Array, encoding?: BufferEncoding) {
      if (tag) throw new Error("This adapter accepts one cipher update per nonce.");
      const encrypted = gcm(key, iv).encrypt(bytes(value, encoding));
      tag = Buffer.from(encrypted.slice(-16));
      return Buffer.from(encrypted.slice(0, -16));
    },
    final() { if (!tag) throw new Error("Cipher was not initialized."); return Buffer.alloc(0); },
    getAuthTag() { if (!tag) throw new Error("Missing authentication tag."); return tag; }
  };
}
export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  if (algorithm !== "aes-256-gcm" || key.length !== 32) throw new Error("Unsupported cipher.");
  let tag: Uint8Array | undefined;
  let encrypted: Uint8Array | undefined;
  return {
    setAuthTag(value: Uint8Array) { tag = value; },
    update(value: Uint8Array) { encrypted = value; return Buffer.alloc(0); },
    final() {
      if (!tag || !encrypted) throw new Error("Incomplete encrypted value.");
      return Buffer.from(gcm(key, iv).decrypt(Buffer.concat([encrypted, tag])));
    }
  };
}
