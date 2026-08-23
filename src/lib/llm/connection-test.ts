import { readDecryptedLlmCredential } from "@/lib/credentials";
import type { LlmProviderAlias, LlmProviderName, LlmProviderErrorKind } from "./types";
import { classifyProviderStatus } from "./types";
import { parseOpenAiCompatibleModelList } from "./model-list";

export type LlmConnectionTestInput = {
  provider?: unknown;
  baseUrl?: unknown;
  model?: unknown;
};

export type LlmConnectionTestResult = {
  ok: boolean;
  provider: LlmProviderName;
  model: string | null;
  credentialSource: "user-vault" | "server-env" | "none";
  latencyMs: number;
  errorType?: LlmConnectionTestErrorType;
  error?: string;
  retryable?: boolean;
  httpStatus?: number;
  diagnostic?: string;
};

type LlmConnectionTestErrorType =
  | LlmProviderErrorKind
  | "missing_api_key"
  | "invalid_configuration"
  | "unsupported_provider";

type ResolvedConnectionConfig = {
  provider: LlmProviderName;
  apiKey: string;
  baseUrl: string;
  model: string | null;
  credentialSource: "user-vault" | "server-env";
};

const defaultCompatibleBaseUrl = "https://api.tryanotherone.com/v1";
const defaultOpenAiBaseUrl = "https://api.openai.com/v1";
const defaultAnthropicBaseUrl = "https://api.anthropic.com";
const defaultGeminiBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
const allowedProviders = new Set<LlmProviderAlias>([
  "compatible",
  "openai-compatible",
  "anthropic",
  "gemini",
  "openai-responses"
]);

export async function testLlmConnection(
  userId: string,
  input: LlmConnectionTestInput
): Promise<LlmConnectionTestResult> {
  const startedAt = Date.now();

  try {
    const config = await resolveConnectionConfig(userId, input);
    const response = await fetch(buildModelListUrl(config), {
      headers: buildModelListHeaders(config),
      signal: AbortSignal.timeout(12_000)
    });

    if (!response.ok) {
      const classification = classifyProviderStatus(response.status);
      return {
        ok: false,
        provider: config.provider,
        model: config.model,
        credentialSource: config.credentialSource,
        latencyMs: Date.now() - startedAt,
        errorType: classification.kind,
        error: toFriendlyConnectionError(classification.kind, response.status),
        httpStatus: response.status,
        diagnostic: `Provider /models endpoint returned HTTP ${response.status}.`,
        retryable: classification.retryable
      };
    }

    if (config.provider === "compatible") {
      const payload = await response.json().catch(() => undefined);
      const parsed =
        payload === undefined
          ? {
              ok: false as const,
              diagnostic: "Provider /models response was not valid JSON."
            }
          : parseOpenAiCompatibleModelList(payload);

      if (!parsed.ok) {
        return {
          ok: false,
          provider: config.provider,
          model: config.model,
          credentialSource: config.credentialSource,
          latencyMs: Date.now() - startedAt,
          errorType: "provider_response",
          error: "连接测试收到响应，但模型列表格式不是常见 OpenAI-compatible 结构。",
          diagnostic: parsed.diagnostic,
          retryable: false
        };
      }
    }

    return {
      ok: true,
      provider: config.provider,
      model: config.model,
      credentialSource: config.credentialSource,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    const fallback = await readFallbackMetadata(userId, input);
    return {
      ok: false,
      provider: fallback.provider,
      model: fallback.model,
      credentialSource: fallback.credentialSource,
      latencyMs: Date.now() - startedAt,
      ...toConnectionFailure(error)
    };
  }
}

async function resolveConnectionConfig(
  userId: string,
  input: LlmConnectionTestInput
): Promise<ResolvedConnectionConfig> {
  const credential = await readDecryptedLlmCredential(userId);
  const provider = readProvider(input.provider, credential?.provider);
  const apiKey = credential?.apiKey || readEnvApiKey(provider);
  const model =
    readOptionalString(input.model, 128) ?? credential?.model?.trim() ?? process.env.LLM_MODEL?.trim() ?? null;
  const baseUrl =
    readOptionalString(input.baseUrl, 512) ??
    credential?.baseUrl?.trim() ??
    process.env.LLM_BASE_URL?.trim() ??
    readDefaultBaseUrl(provider);

  if (!apiKey) {
    throw new LlmConnectionTestConfigurationError(
      "missing_api_key",
      "请先保存 API Key，或在服务端环境变量中配置 LLM_API_KEY。"
    );
  }
  const credentialSource: ResolvedConnectionConfig["credentialSource"] = credential?.apiKey
    ? "user-vault"
    : "server-env";

  if (!baseUrl) {
    throw new LlmConnectionTestConfigurationError(
      "invalid_configuration",
      "请先填写模型供应商地址。"
    );
  }

  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new LlmConnectionTestConfigurationError(
      "invalid_configuration",
      "模型供应商地址必须以 http:// 或 https:// 开头。"
    );
  }

  return {
    provider,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    credentialSource
  };
}

async function readFallbackMetadata(userId: string, input: LlmConnectionTestInput) {
  const credential = await readDecryptedLlmCredential(userId).catch(() => null);
  const provider = readProviderForFallback(input.provider, credential?.provider);
  const hasEnvKey = Boolean(readEnvApiKey(provider));
  return {
    provider,
    model:
      readOptionalString(input.model, 128) ?? credential?.model?.trim() ?? process.env.LLM_MODEL?.trim() ?? null,
    credentialSource: credential?.apiKey ? "user-vault" : hasEnvKey ? "server-env" : "none"
  } as const;
}

function readProviderForFallback(value: unknown, fallback?: string): LlmProviderName {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return normalizeProvider(candidate) ?? normalizeProvider(process.env.LLM_PROVIDER) ?? "compatible";
}

function readProvider(value: unknown, fallback?: string): LlmProviderName {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;

  if (!candidate) {
    return normalizeProvider(process.env.LLM_PROVIDER) ?? "compatible";
  }

  if (!allowedProviders.has(candidate as LlmProviderAlias)) {
    throw new LlmConnectionTestConfigurationError("unsupported_provider", "暂不支持这个模型供应商。");
  }

  return normalizeProvider(candidate) ?? "compatible";
}

function normalizeProvider(value: string | undefined | null): LlmProviderName | null {
  if (value === "openai-compatible") return "compatible";
  if (
    value === "compatible" ||
    value === "anthropic" ||
    value === "gemini" ||
    value === "openai-responses"
  ) {
    return value;
  }

  return null;
}

function readEnvApiKey(provider: LlmProviderName) {
  const neutralKey = process.env.LLM_API_KEY?.trim();
  if (neutralKey) return neutralKey;

  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY?.trim();
  if (provider === "gemini") {
    return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  }
  return process.env.OPENAI_API_KEY?.trim();
}

function readDefaultBaseUrl(provider: LlmProviderName) {
  if (provider === "anthropic") return defaultAnthropicBaseUrl;
  if (provider === "gemini") return defaultGeminiBaseUrl;
  if (provider === "openai-responses") return defaultOpenAiBaseUrl;
  return defaultCompatibleBaseUrl;
}

function readOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function buildModelListUrl(config: ResolvedConnectionConfig) {
  if (config.provider === "gemini") {
    const url = new URL(`${config.baseUrl}/models`);
    url.searchParams.set("key", config.apiKey);
    return url;
  }

  if (config.provider === "anthropic") {
    return new URL(`${trimKnownVersionSuffix(config.baseUrl)}/v1/models`);
  }

  return new URL(`${config.baseUrl}/models`);
}

function trimKnownVersionSuffix(baseUrl: string) {
  return baseUrl.replace(/\/v1(?:beta)?$/i, "");
}

function buildModelListHeaders(config: ResolvedConnectionConfig): HeadersInit {
  if (config.provider === "gemini") {
    return {};
  }

  if (config.provider === "anthropic") {
    return {
      "anthropic-version": process.env.ANTHROPIC_VERSION ?? "2023-06-01",
      "x-api-key": config.apiKey
    };
  }

  return {
    Authorization: `Bearer ${config.apiKey}`
  };
}

function toConnectionFailure(error: unknown) {
  if (error instanceof LlmConnectionTestConfigurationError) {
    return {
      errorType: error.errorType,
      error: error.message,
      retryable: false
    };
  }

  const isTimeout =
    error instanceof DOMException
      ? error.name === "AbortError" || error.name === "TimeoutError"
      : error instanceof Error && /abort|timeout/i.test(error.name);

  return {
    errorType: isTimeout ? "timeout" : "network",
    error: isTimeout ? "连接测试超时，请稍后再试。" : "无法连接到模型供应商，请检查网络或供应商配置。",
    retryable: true
  } satisfies {
    errorType: LlmConnectionTestErrorType;
    error: string;
    retryable: boolean;
  };
}

function toFriendlyConnectionError(kind: LlmProviderErrorKind, status?: number) {
  const statusPrefix = typeof status === "number" ? `供应商返回 HTTP ${status}。` : "";
  if (kind === "authentication") return "API Key 无效、权限不足，或供应商拒绝了这次请求。";
  if (kind === "rate_limit") return "供应商限流了这次测试，请稍后再试。";
  if (kind === "timeout") return "连接测试超时，请稍后再试。";
  return `${statusPrefix}请检查供应商配置或稍后再试。`;
}

class LlmConnectionTestConfigurationError extends Error {
  constructor(
    readonly errorType: LlmConnectionTestErrorType,
    message: string
  ) {
    super(message);
    this.name = "LlmConnectionTestConfigurationError";
  }
}
