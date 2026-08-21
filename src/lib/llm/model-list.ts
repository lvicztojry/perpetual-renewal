import { readDecryptedLlmCredential } from "@/lib/credentials";

export type LlmModelListItem = {
  id: string;
  ownedBy?: string;
};

export type LlmModelListResult = {
  provider: string;
  credentialSource: "user-vault" | "server-env";
  models: LlmModelListItem[];
};

export class LlmModelListError extends Error {
  constructor(
    message: string,
    readonly code:
      | "missing_api_key"
      | "unsupported_provider"
      | "provider_http_error"
      | "provider_network_error"
      | "provider_timeout"
      | "invalid_provider_response",
    readonly options: {
      httpStatus?: number;
      retryable: boolean;
    }
  ) {
    super(message);
    this.name = "LlmModelListError";
  }
}

const defaultCompatibleBaseUrl = "https://api.tryanotherone.com/v1";

export async function listAvailableLlmModels(userId: string): Promise<LlmModelListResult> {
  const credential = await readDecryptedLlmCredential(userId);
  const provider = credential?.provider ?? process.env.LLM_PROVIDER ?? "compatible";
  const normalizedProvider = provider === "openai-compatible" ? "compatible" : provider;

  if (normalizedProvider !== "compatible") {
    throw new LlmModelListError(
      "Model listing currently supports compatible providers only.",
      "unsupported_provider",
      { retryable: false }
    );
  }

  const apiKey =
    credential?.apiKey || process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const baseUrl = credential?.baseUrl || process.env.LLM_BASE_URL?.trim() || defaultCompatibleBaseUrl;

  if (!apiKey) {
    throw new LlmModelListError(
      "Model listing requires a saved user API key or server LLM_API_KEY.",
      "missing_api_key",
      { retryable: false }
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(12_000)
    });
  } catch (error) {
    const isTimeout =
      error instanceof DOMException
        ? error.name === "AbortError" || error.name === "TimeoutError"
        : error instanceof Error && /abort|timeout/i.test(error.name);
    throw new LlmModelListError(
      isTimeout ? "Model listing timed out." : "Model listing network request failed.",
      isTimeout ? "provider_timeout" : "provider_network_error",
      { retryable: true }
    );
  }

  if (!response.ok) {
    throw new LlmModelListError(
      `Model listing failed with HTTP ${response.status}.`,
      "provider_http_error",
      {
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500
      }
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{
      id?: unknown;
      owned_by?: unknown;
      ownedBy?: unknown;
    }>;
  } | null;
  if (!payload || !Array.isArray(payload.data)) {
    throw new LlmModelListError(
      "Model listing returned an unsupported response shape.",
      "invalid_provider_response",
      { retryable: false }
    );
  }

  return {
    provider: "compatible",
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
