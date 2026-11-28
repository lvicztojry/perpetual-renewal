import { AnthropicProvider } from "./anthropic-provider";
import { CompatibleChatProvider } from "./compatible-chat-provider";
import { GeminiProvider } from "./gemini-provider";
import { MockLlmProvider } from "./mock-provider";
import { OpenAiResponsesProvider } from "./openai-responses-provider";
import type { LlmProvider, LlmProviderAlias, LlmProviderName } from "./types";

export type LlmProviderConfig = {
  provider?: LlmProviderAlias | string;
  apiKey?: string;
  baseUrl?: string | null;
  model?: string | null;
};

export function createLlmProvider(config: LlmProviderConfig = {}): LlmProvider {
  const requestedProvider = config.provider?.trim() || process.env.LLM_PROVIDER?.trim();
  const providerName = readProviderName(requestedProvider);
  const apiKey = config.apiKey?.trim() || readApiKey(providerName);
  const model = config.model?.trim() || process.env.LLM_MODEL?.trim();

  if (providerName === "mock") {
    return new MockLlmProvider(readMockFallbackReason(requestedProvider));
  }

  const explicitBaseUrl = config.baseUrl?.trim();
  const baseUrl =
    explicitBaseUrl || (providerName === "compatible" ? process.env.LLM_BASE_URL?.trim() : undefined);
  const missingConfig = readMissingConfig(providerName, { apiKey, model, baseUrl });
  if (missingConfig.length > 0) {
    return new MockLlmProvider(
      `${providerName} provider missing ${missingConfig.join(", ")}; using mock provider.`
    );
  }

  const configuredApiKey = apiKey;
  const configuredModel = model;

  if (!configuredApiKey || !configuredModel) {
    return new MockLlmProvider(`${providerName} provider missing required config; using mock provider.`);
  }

  if (providerName === "anthropic") {
    return new AnthropicProvider({
      apiKey: configuredApiKey,
      baseUrl: explicitBaseUrl,
      model: configuredModel,
      version: process.env.ANTHROPIC_VERSION
    });
  }

  if (providerName === "gemini") {
    return new GeminiProvider({
      apiKey: configuredApiKey,
      baseUrl: explicitBaseUrl,
      model: configuredModel
    });
  }

  if (providerName === "openai-responses") {
    return new OpenAiResponsesProvider({
      apiKey: configuredApiKey,
      baseUrl: explicitBaseUrl,
      model: configuredModel
    });
  }

  if (providerName === "compatible" && baseUrl) {
    return new CompatibleChatProvider({
      apiKey: configuredApiKey,
      baseUrl,
      model: configuredModel
    });
  }

  return new MockLlmProvider("compatible provider missing LLM_BASE_URL; using mock provider.");
}

function readProviderName(value: string | undefined): LlmProviderName {
  if (value === "openai-compatible") {
    return "compatible";
  }

  if (
    value === "openai-responses" ||
    value === "compatible" ||
    value === "anthropic" ||
    value === "gemini" ||
    value === "mock"
  ) {
    return value;
  }

  return "mock";
}

function readApiKey(providerName: LlmProviderName) {
  const neutralKey = process.env.LLM_API_KEY?.trim();

  if (neutralKey) {
    return neutralKey;
  }

  if (providerName === "anthropic") {
    return process.env.ANTHROPIC_API_KEY?.trim();
  }

  if (providerName === "gemini") {
    return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  }

  if (providerName === "openai-responses" || providerName === "compatible") {
    return process.env.OPENAI_API_KEY?.trim();
  }

  return undefined;
}

function readMissingConfig(
  providerName: LlmProviderName,
  values: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  }
) {
  const missing: string[] = [];

  if (!values.apiKey) {
    missing.push(readApiKeyLabel(providerName));
  }

  if (!values.model) {
    missing.push("LLM_MODEL");
  }

  if (providerName === "compatible" && !values.baseUrl) {
    missing.push("LLM_BASE_URL");
  }

  return missing;
}

function readApiKeyLabel(providerName: LlmProviderName) {
  if (providerName === "anthropic") {
    return "LLM_API_KEY or ANTHROPIC_API_KEY";
  }

  if (providerName === "gemini") {
    return "LLM_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY";
  }

  if (providerName === "openai-responses" || providerName === "compatible") {
    return "LLM_API_KEY or OPENAI_API_KEY";
  }

  return "LLM_API_KEY";
}

function readMockFallbackReason(requestedProvider: string | undefined) {
  if (!requestedProvider) {
    return "LLM_PROVIDER is unset; using mock provider.";
  }

  if (requestedProvider === "mock") {
    return "LLM_PROVIDER=mock; using mock provider.";
  }

  return `Unsupported LLM_PROVIDER=${requestedProvider}; using mock provider.`;
}
