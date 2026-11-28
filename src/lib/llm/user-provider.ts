import { readDecryptedLlmCredential } from "@/lib/credentials";
import { createLlmProvider } from "./provider";

export async function createUserLlmProvider(userId: string) {
  const credential = await readDecryptedLlmCredential(userId);
  return createLlmProvider(
    credential
      ? {
          provider: credential.provider,
          apiKey: credential.apiKey,
          baseUrl: credential.baseUrl,
          model: credential.model
        }
      : undefined
  );
}

