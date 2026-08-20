import {
  classifyProviderStatus,
  LlmProviderError,
  toLlmProviderError,
  type LlmCompletion,
  type LlmCompletionOptions,
  type LlmProvider
} from "./types";

type AnthropicProviderConfig = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  version?: string;
};

type AnthropicMessageResponse = {
  id?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_VERSION = "2023-06-01";

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly version: string;

  constructor(config: AnthropicProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl?.trim() || DEFAULT_BASE_URL);
    this.defaultModel = config.model.trim();
    this.version = config.version?.trim() || DEFAULT_VERSION;
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletion> {
    const model = options.model?.trim() || this.defaultModel;
    const systemText = options.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n")
      .trim();
    const messages = options.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: message.content
      }));

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": this.version,
          "x-api-key": this.apiKey
        },
        body: JSON.stringify({
          model,
          max_tokens: options.maxTokens ?? 1024,
          messages,
          system: systemText ? [{ type: "text", text: systemText }] : undefined,
          temperature: options.temperature ?? 0.82,
          stream: false
        }),
        signal: options.signal
      });
    } catch (error) {
      throw toLlmProviderError(error, { provider: this.name, model });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const classification = classifyProviderStatus(response.status);
      throw new LlmProviderError("Anthropic provider request failed.", {
        ...classification,
        provider: this.name,
        model,
        status: response.status,
        cause: errorBody
      });
    }

    const payload = (await response.json()) as AnthropicMessageResponse;
    const content = payload.content
      ?.filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("")
      .trim();

    if (!content) {
      throw new LlmProviderError("Anthropic provider returned an empty completion.", {
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
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
        totalTokens:
          payload.usage?.input_tokens !== undefined && payload.usage?.output_tokens !== undefined
            ? payload.usage.input_tokens + payload.usage.output_tokens
            : undefined
      },
      raw: payload
    };
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}
