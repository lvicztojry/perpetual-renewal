import {
  classifyProviderStatus,
  LlmProviderError,
  toLlmProviderError,
  type LlmCompletion,
  type LlmCompletionOptions,
  type LlmProvider
} from "./types";

type GeminiProviderConfig = {
  apiKey: string;
  baseUrl?: string;
  model: string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl?.trim() || DEFAULT_BASE_URL);
    this.defaultModel = normalizeModel(config.model);
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletion> {
    const model = normalizeModel(options.model?.trim() || this.defaultModel);
    const systemText = options.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n")
      .trim();
    const contents = options.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      }));
    const url = new URL(`${this.baseUrl}/${model}:generateContent`);
    url.searchParams.set("key", this.apiKey);

    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents,
          systemInstruction: systemText
            ? {
                parts: [{ text: systemText }]
              }
            : undefined,
          generationConfig: {
            temperature: options.temperature ?? 0.82,
            maxOutputTokens: options.maxTokens
          }
        }),
        signal: options.signal
      });
    } catch (error) {
      throw toLlmProviderError(error, { provider: this.name, model });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const classification = classifyProviderStatus(response.status);
      throw new LlmProviderError("Gemini provider request failed.", {
        ...classification,
        provider: this.name,
        model,
        status: response.status,
        cause: errorBody
      });
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;
    const content = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!content) {
      throw new LlmProviderError("Gemini provider returned an empty completion.", {
        kind: "provider_response",
        provider: this.name,
        model,
        retryable: false,
        cause: payload
      });
    }

    return {
      content,
      provider: this.name,
      model: payload.modelVersion ?? model,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount,
        outputTokens: payload.usageMetadata?.candidatesTokenCount,
        totalTokens: payload.usageMetadata?.totalTokenCount
      },
      raw: payload
    };
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function normalizeModel(model: string) {
  const trimmed = model.trim();
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}
