import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shouldFallbackToMemoryOnPrismaError, shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import type {
  DecryptedLlmCredential,
  ProviderCredentialStatus,
  SaveLlmCredentialInput
} from "./types";
import { decryptSecret, encryptSecret } from "./vault";

type CredentialRecord = {
  userId: string;
  kind: "llm";
  provider: string;
  baseUrl: string | null;
  model: string | null;
  encryptedApiKey: string;
  keyIv: string;
  keyAuthTag: string;
  keyFingerprint: string;
  keyPreview: string;
  encryptionVersion: string;
  status: string;
  updatedAt: Date;
};

const databaseUnavailableCodes = new Set(["P1000", "P1001", "P1002", "P1003", "P2021", "P2024"]);

type FallbackCredentialStore = Map<string, CredentialRecord>;

declare global {
  var renewalCredentialStore: FallbackCredentialStore | undefined;
}

export async function saveLlmCredential(userId: string, input: SaveLlmCredentialInput) {
  const existingRecord = await readCredentialRecord(userId);

  if (!input.apiKey && !existingRecord) {
    throw new Error("apiKey is required when no saved credential exists.");
  }

  const encrypted = input.apiKey ? encryptSecret(input.apiKey) : null;
  const baseUrl =
    input.baseUrl === undefined
      ? existingRecord?.baseUrl ?? null
      : input.baseUrl?.trim() || null;

  if ((input.provider === "compatible" || input.provider === "openai-compatible") && !baseUrl) {
    throw new Error("compatible provider requires Base URL.");
  }

  const record: CredentialRecord = {
    userId,
    kind: "llm",
    provider: input.provider,
    baseUrl,
    model: input.model?.trim() || null,
    encryptedApiKey: encrypted?.encrypted ?? existingRecord?.encryptedApiKey ?? "",
    keyIv: encrypted?.iv ?? existingRecord?.keyIv ?? "",
    keyAuthTag: encrypted?.authTag ?? existingRecord?.keyAuthTag ?? "",
    keyFingerprint: encrypted?.fingerprint ?? existingRecord?.keyFingerprint ?? "",
    keyPreview: encrypted?.preview ?? existingRecord?.keyPreview ?? "",
    encryptionVersion: encrypted?.version ?? existingRecord?.encryptionVersion ?? "",
    status: "active",
    updatedAt: new Date()
  };

  if (shouldUseFallbackCredentials()) {
    getFallbackStore().set(userId, record);
    return toCredentialStatus(record);
  }

  try {
    await prisma.providerCredential.upsert({
      where: { userId_kind: { userId, kind: "llm" } },
      update: {
        provider: record.provider,
        baseUrl: record.baseUrl,
        model: record.model,
        encryptedApiKey: record.encryptedApiKey,
        keyIv: record.keyIv,
        keyAuthTag: record.keyAuthTag,
        keyFingerprint: record.keyFingerprint,
        keyPreview: record.keyPreview,
        encryptionVersion: record.encryptionVersion,
        status: "active"
      },
      create: record
    });
  } catch (error) {
    if (!shouldFallbackToMemory(error)) throw error;
    getFallbackStore().set(userId, record);
  }

  return toCredentialStatus(record);
}

export async function getLlmCredentialStatus(userId: string): Promise<ProviderCredentialStatus> {
  const record = await readCredentialRecord(userId);
  return record ? toCredentialStatus(record) : emptyStatus();
}

export async function deleteLlmCredential(userId: string) {
  if (shouldUseFallbackCredentials()) {
    getFallbackStore().delete(userId);
    return emptyStatus();
  }

  try {
    await prisma.providerCredential.deleteMany({
      where: { userId, kind: "llm" }
    });
  } catch (error) {
    if (!shouldFallbackToMemory(error)) throw error;
  }

  getFallbackStore().delete(userId);
  return emptyStatus();
}

export async function readDecryptedLlmCredential(
  userId: string
): Promise<DecryptedLlmCredential | null> {
  const record = await readCredentialRecord(userId);
  if (!record || record.status !== "active") return null;

  return {
    provider: record.provider as DecryptedLlmCredential["provider"],
    apiKey: decryptSecret({
      encrypted: record.encryptedApiKey,
      iv: record.keyIv,
      authTag: record.keyAuthTag,
      version: record.encryptionVersion
    }),
    baseUrl: record.baseUrl ?? undefined,
    model: record.model ?? undefined
  };
}

async function readCredentialRecord(userId: string): Promise<CredentialRecord | null> {
  if (shouldUseFallbackCredentials()) {
    return getFallbackStore().get(userId) ?? null;
  }

  try {
    const record = await prisma.providerCredential.findUnique({
      where: { userId_kind: { userId, kind: "llm" } }
    });
    return record ? toCredentialRecord(record) : null;
  } catch (error) {
    if (!shouldFallbackToMemory(error)) throw error;
    return getFallbackStore().get(userId) ?? null;
  }
}

function shouldUseFallbackCredentials() {
  return shouldUseMemoryFallback();
}

function toCredentialStatus(record: CredentialRecord): ProviderCredentialStatus {
  return {
    configured: record.status === "active",
    kind: "llm",
    provider: record.provider,
    endpointConfigured: Boolean(record.baseUrl),
    endpointFingerprint: record.baseUrl ? fingerprintEndpoint(record.baseUrl) : null,
    model: record.model,
    keyPreview: record.keyPreview,
    keyFingerprint: record.keyFingerprint,
    credentialSource: "user-vault",
    updatedAt: record.updatedAt.toISOString()
  };
}

function emptyStatus(): ProviderCredentialStatus {
  return {
    configured: false,
    kind: "llm",
    provider: null,
    endpointConfigured: false,
    endpointFingerprint: null,
    model: null,
    keyPreview: null,
    keyFingerprint: null,
    credentialSource: "server-env",
    updatedAt: null
  };
}

function fingerprintEndpoint(baseUrl: string) {
  return createHash("sha256").update(baseUrl.trim().replace(/\/+$/, "")).digest("hex").slice(0, 12);
}

function toCredentialRecord(
  record: Prisma.ProviderCredentialGetPayload<Record<string, never>>
): CredentialRecord {
  return {
    userId: record.userId,
    kind: "llm",
    provider: record.provider,
    baseUrl: record.baseUrl,
    model: record.model,
    encryptedApiKey: record.encryptedApiKey,
    keyIv: record.keyIv,
    keyAuthTag: record.keyAuthTag,
    keyFingerprint: record.keyFingerprint,
    keyPreview: record.keyPreview,
    encryptionVersion: record.encryptionVersion,
    status: record.status,
    updatedAt: record.updatedAt
  };
}

function getFallbackStore() {
  globalThis.renewalCredentialStore ??= new Map();
  return globalThis.renewalCredentialStore;
}

function shouldFallbackToMemory(error: unknown) {
  return shouldFallbackToMemoryOnPrismaError(error, {
    codes: databaseUnavailableCodes,
    schemaHints: ['relation "ProviderCredential" does not exist']
  });
}
