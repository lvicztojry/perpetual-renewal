import {
  classifyProviderStatus,
  LlmProviderError,
  toLlmProviderError,
  type LlmCompletion,
  type LlmCompletionOptions,
  type LlmMessage,
  type LlmProvider
} from "./types";

type OpenAiResponsesProviderConfig = {
  apiKey: string;
  baseUrl?: string;
  model: string;
};

type ResponseApiPayload = {
  id?: string;
  model?: string;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class OpenAiResponsesProvider implements LlmProvider {
  readonly name = "openai-responses";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(config: OpenAiResponsesProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl?.trim() || DEFAULT_BASE_URL);
    this.defaultModel = config.model.trim();
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletion> {
    const model = options.model?.trim() || this.defaultModel;
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: options.messages.map(toResponseInputMessage),
          temperature: options.temperature ?? 0.82,
          max_output_tokens: options.maxTokens
        }),
        signal: options.signal
      });
    } catch (error) {
      throw toLlmProviderError(error, { provider: this.name, model });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const classification = classifyProviderStatus(response.status);
      throw new LlmProviderError("OpenAI Responses request failed.", {
        ...classification,
        provider: this.name,
        model,
        status: response.status,
        cause: errorBody
      });
    }

    const payload = (await response.json()) as ResponseApiPayload;
    const content = readResponseText(payload);

    if (!content) {
      throw new LlmProviderError("OpenAI Responses returned an empty completion.", {
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
        totalTokens: payload.usage?.total_tokens
      },
      raw: payload
    };
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function toResponseInputMessage(message: LlmMessage) {
  return {
    role: message.role,
    content: message.content
  };
}

function readResponseText(payload: ResponseApiPayload) {
  if (payload.output_text?.trim()) return payload.output_text.trim();

  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}
