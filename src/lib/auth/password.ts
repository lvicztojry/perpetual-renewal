import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { AuthError } from "./errors";

const keyLength = 64;
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const dummyHash = `scrypt-v1$${"00".repeat(16)}$${"00".repeat(keyLength)}`;

export function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) {
    throw new AuthError("密码须为 12–128 个字符。");
  }
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string) {
  validatePassword(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt-v1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: unknown, storedHash?: string | null) {
  const validInput = typeof password === "string" && password.length > 0 && password.length <= 128;
  const validHash = typeof storedHash === "string" && /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(storedHash);
  const [, salt, expected] = (validHash ? storedHash : dummyHash).split("$");
  const actual = await derive(validInput ? password : "invalid-password", Buffer.from(salt, "hex"));
  return timingSafeEqual(actual, Buffer.from(expected, "hex")) && validInput && validHash;
}
