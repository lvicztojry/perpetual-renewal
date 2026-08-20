import { readDecryptedLlmCredential } from "@/lib/credentials";

export type LlmModelListItem = {
  id: string;
  ownedBy?: string;
};

export type LlmModelListResult = {
  provider: string;
  baseUrl: string;
  credentialSource: "user-vault" | "server-env";
  models: LlmModelListItem[];
};

const defaultCompatibleBaseUrl = "https://api.tryanotherone.com/v1";

export async function listAvailableLlmModels(userId: string): Promise<LlmModelListResult> {
  const credential = await readDecryptedLlmCredential(userId);
  const provider = credential?.provider ?? process.env.LLM_PROVIDER ?? "compatible";
  const normalizedProvider = provider === "openai-compatible" ? "compatible" : provider;

  if (normalizedProvider !== "compatible") {
    throw new Error("Model listing currently supports compatible providers only.");
  }

  const apiKey =
    credential?.apiKey || process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const baseUrl = credential?.baseUrl || process.env.LLM_BASE_URL?.trim() || defaultCompatibleBaseUrl;

  if (!apiKey) {
    throw new Error("Model listing requires a saved user API key or server LLM_API_KEY.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(12_000)
  });

  if (!response.ok) {
    throw new Error(`Model listing failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id?: unknown;
      owned_by?: unknown;
      ownedBy?: unknown;
    }>;
  };

  return {
    provider: "compatible",
    baseUrl,
    credentialSource: credential ? "user-vault" : "server-env",
    models: (payload.data ?? [])
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        ownedBy:
          typeof item.owned_by === "string"
            ? item.owned_by
            : typeof item.ownedBy === "string"
              ? item.ownedBy
              : undefined
      }))
      .filter((item) => item.id)
  };
}
