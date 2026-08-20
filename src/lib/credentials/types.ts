import type { LlmProviderAlias } from "@/lib/llm/types";

export type ProviderCredentialKind = "llm";

export type ProviderCredentialStatus = {
  configured: boolean;
  kind: ProviderCredentialKind;
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  keyPreview: string | null;
  keyFingerprint: string | null;
  credentialSource: "user-vault" | "server-env";
  updatedAt: string | null;
};

export type SaveLlmCredentialInput = {
  provider: LlmProviderAlias;
  apiKey?: string;
  baseUrl?: string | null;
  model?: string | null;
};

export type DecryptedLlmCredential = {
  provider: LlmProviderAlias;
  apiKey: string;
  baseUrl?: string;
  model?: string;
};
