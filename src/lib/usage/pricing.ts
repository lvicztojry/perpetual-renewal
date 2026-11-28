import type { LlmTokenUsage } from "@/lib/llm/types";

type Price = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

const providerDefaults: Record<string, Price> = {
  mock: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
  compatible: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
  anthropic: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  gemini: { inputUsdPerMillion: 0.35, outputUsdPerMillion: 1.05 },
  "openai-responses": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 }
};

export function estimateCostUsd(provider: string, usage?: LlmTokenUsage) {
  const price = readPriceOverride() ?? providerDefaults[provider] ?? providerDefaults.compatible;
  const inputCost = ((usage?.inputTokens ?? 0) / 1_000_000) * price.inputUsdPerMillion;
  const outputCost = ((usage?.outputTokens ?? 0) / 1_000_000) * price.outputUsdPerMillion;

  return roundUsd(inputCost + outputCost);
}

function readPriceOverride(): Price | null {
  const input = readNumber(process.env.LLM_INPUT_COST_USD_PER_1M);
  const output = readNumber(process.env.LLM_OUTPUT_COST_USD_PER_1M);

  if (input === null && output === null) return null;

  return {
    inputUsdPerMillion: input ?? 0,
    outputUsdPerMillion: output ?? input ?? 0
  };
}

function readNumber(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

