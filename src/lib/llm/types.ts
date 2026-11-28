export type LlmProviderName =
  | "mock"
  | "compatible"
  | "anthropic"
  | "gemini"
  | "openai-responses";

export type LlmProviderAlias = LlmProviderName | "openai-compatible";

export type LlmMessageRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmMessageRole;
  content: string;
};

export type LlmCompletionOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  messages: LlmMessage[];
  signal?: AbortSignal;
};

export type LlmCompletion = {
  content: string;
  provider: string;
  model: string;
  usage?: LlmTokenUsage;
  fallbackReason?: string;
  raw?: unknown;
};

export type LlmTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export interface LlmProvider {
  readonly name: LlmProviderName;
  complete(options: LlmCompletionOptions): Promise<LlmCompletion>;
}

export type LlmProviderErrorKind =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "provider_response";

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly details: {
      kind: LlmProviderErrorKind;
      provider: string;
      model?: string;
      status?: number;
      retryable?: boolean;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}

export function classifyProviderStatus(status: number): {
  kind: LlmProviderErrorKind;
  retryable: boolean;
} {
  if (status === 401 || status === 403) {
    return { kind: "authentication", retryable: false };
  }

  if (status === 408) {
    return { kind: "timeout", retryable: true };
  }

  if (status === 429) {
    return { kind: "rate_limit", retryable: true };
  }

  if (status >= 500) {
    return { kind: "provider_response", retryable: true };
  }

  return { kind: "provider_response", retryable: false };
}

export function toLlmProviderError(
  error: unknown,
  details: {
    provider: string;
    model?: string;
  }
): LlmProviderError {
  if (error instanceof LlmProviderError) {
    return error;
  }

  const isAbort =
    error instanceof DOMException
      ? error.name === "AbortError" || error.name === "TimeoutError"
      : error instanceof Error && /abort|timeout/i.test(error.name);

  return new LlmProviderError(
    isAbort ? "LLM provider request timed out." : "LLM provider network request failed.",
    {
      kind: isAbort ? "timeout" : "network",
      provider: details.provider,
      model: details.model,
      retryable: true,
      cause: error
    }
  );
}
