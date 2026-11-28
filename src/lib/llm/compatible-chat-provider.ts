import {
  classifyProviderStatus,
  LlmProviderError,
  toLlmProviderError,
  type LlmCompletion,
  type LlmCompletionOptions,
  type LlmMessage,
  type LlmProvider
} from "./types";

type CompatibleChatProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

type ChatCompletionResponse = {
  id?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
};

export class CompatibleChatProvider implements LlmProvider {
  readonly name = "compatible";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(config: CompatibleChatProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl.trim());
    this.defaultModel = config.model.trim();
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletion> {
    const model = options.model?.trim() || this.defaultModel;
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: options.messages.map(toChatCompletionMessage),
          temperature: options.temperature ?? 0.82,
          max_tokens: options.maxTokens
        }),
        signal: options.signal
      });
    } catch (error) {
      throw toLlmProviderError(error, { provider: this.name, model });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const classification = classifyProviderStatus(response.status);
      throw new LlmProviderError("LLM provider request failed.", {
        ...classification,
        provider: this.name,
        model,
        status: response.status,
        cause: errorBody
      });
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new LlmProviderError("LLM provider returned an empty completion.", {
        kind: "provider_response",
        provider: this.name,
        model: payload.model ?? model,
        retryable: false,
        cause: payload
      });
    }

    return {
      content,
      provider: this.name,
      model: payload.model ?? model,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
        totalTokens: payload.usage?.total_tokens
      },
      raw: payload
    };
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function toChatCompletionMessage(message: LlmMessage) {
  return {
    role: message.role,
    content: message.content
  };
}
