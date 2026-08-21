import { createLlmProvider } from "@/lib/llm/provider";
import type { LlmProvider, LlmTokenUsage } from "@/lib/llm/types";
import { buildRenewalPrompt, type BuildPromptInput } from "@/lib/prompt-builder";
import { normalizeAssistantReplyContent } from "./reply-format";

export type GenerateCompanionReplyInput = BuildPromptInput & {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type GenerateCompanionReplyResult = {
  content: string;
  provider: string;
  model: string;
  usage?: LlmTokenUsage;
  fallbackReason?: string;
  activeMemoryCount: number;
};

export async function generateCompanionReply(
  input: GenerateCompanionReplyInput,
  provider: LlmProvider = createLlmProvider()
): Promise<GenerateCompanionReplyResult> {
  const prompt = buildRenewalPrompt(input);
  const completion = await provider.complete({
    messages: prompt.messages,
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens
  });

  return {
    content: normalizeAssistantReplyContent(completion.content),
    provider: completion.provider,
    model: completion.model,
    usage: completion.usage,
    fallbackReason: completion.fallbackReason,
    activeMemoryCount: prompt.activeMemoryCount
  };
}
