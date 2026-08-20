import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const encryptionVersion = "aes-256-gcm:v1";
const devSecret = "perpetual-renewal-dev-user-key-vault";

export type EncryptedSecret = {
  encrypted: string;
  iv: string;
  authTag: string;
  fingerprint: string;
  preview: string;
  version: string;
};

export function encryptSecret(plainText: string): EncryptedSecret {
  const normalized = plainText.trim();
  if (!normalized) {
    throw new Error("Secret value is required.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, readVaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    fingerprint: createHash("sha256").update(normalized).digest("hex").slice(0, 16),
    preview: previewSecret(normalized),
    version: encryptionVersion
  };
}

export function decryptSecret(input: {
  encrypted: string;
  iv: string;
  authTag: string;
  version: string;
}) {
  if (input.version !== encryptionVersion) {
    throw new Error(`Unsupported credential encryption version: ${input.version}`);
  }

  const decipher = createDecipheriv(
    algorithm,
    readVaultKey(),
    Buffer.from(input.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function readVaultKey() {
  const secret = process.env.USER_KEY_VAULT_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("USER_KEY_VAULT_SECRET is required in production.");
  }

  return createHash("sha256").update(secret || devSecret).digest();
}

function previewSecret(secret: string) {
  const tail = secret.slice(-4);
  return `...${tail}`;
}

