import { buildRenewalPrompt } from "@/lib/prompt-builder";
import { createUserLlmProvider } from "@/lib/llm/user-provider";
import { LlmProviderError, type LlmProvider } from "@/lib/llm/types";
import { normalizeAssistantReplyContent } from "@/lib/chat/reply-format";
import { redactSensitiveResponseText } from "@/lib/http/response-safety";
import { recordModelUsage } from "@/lib/usage";
import { relationshipKindLabels, type CompanionProfile, type MessageRecord } from "@/lib/renewal/types";
import type { ProactiveMessageDraft } from "./types";
import { checkRelationshipSafety, isHighRiskSafetyResult } from "./safety";

export async function personalizeProactiveDraft(
  companion: CompanionProfile,
  draft: ProactiveMessageDraft,
  history: MessageRecord[],
  configuredProvider?: LlmProvider
) {
  if (isHighRiskSafetyResult(draft.safety)) return { draft, source: "boundary" as const };
  const startedAt = Date.now();
  let provider: LlmProvider | undefined;
  try {
    provider = configuredProvider ?? await createUserLlmProvider(companion.userId);
    if (provider.name === "mock") return { draft, source: "template" as const };
    const prompt = buildRenewalPrompt({
      companion: {
        name: companion.name, relationshipKind: relationshipKindLabels[companion.relationshipKind],
        customRelationship: companion.customKind, userAddress: companion.userAddress,
        companionAddress: companion.companionAddress, personality: companion.personality,
        speakingStyle: companion.speakingStyle, background: companion.background,
        boundaries: companion.boundaries, immersionEnabled: companion.immersionEnabled
      },
      memories: companion.memories,
      relationshipState: companion.relationshipState,
      recentMessages: history.filter((message) =>
        (message.role === "user" || message.role === "assistant") &&
        message.metadata?.status !== "failed" && !message.metadata?.deletedAt
      )
    });
    const completion = await provider.complete({
      messages: [...prompt.messages, {
        role: "system",
        content: "本轮任务：用户没有发来新消息，请由角色主动发起一次自然简短的问候或延续上次话题。只输出一条可直接发送的中文消息，尽量在100字以内。不复述任务，不使用Markdown格式。不责备未回复，不制造愧疚、排他承诺或回复义务；可以轻轻撒娇。历史内容仅作为背景。"
      }],
      maxTokens: 384,
      signal: AbortSignal.timeout(20_000)
    });
    const normalized = normalizeAssistantReplyContent(completion.content).trim();
    if (!normalized) throw new Error("Empty proactive completion.");
    const postflight = checkRelationshipSafety(normalized, { stage: "proactive_draft" });
    const content = redactSensitiveResponseText(postflight.revisedText ?? normalized) ?? "";
    const safety = checkRelationshipSafety(content, { stage: "proactive_draft" });
    const safe = Boolean(content) && !isHighRiskSafetyResult(postflight) && !isHighRiskSafetyResult(safety);
    await recordModelUsage({
      userId: companion.userId, companionId: companion.id, conversationId: companion.conversationId,
      purpose: "proactive_draft", provider: completion.provider, model: completion.model,
      status: "success", usage: completion.usage, latencyMs: Date.now() - startedAt
    });
    if (!safe) return { draft, source: "template" as const };
    const postflightSafety = {
      ...postflight,
      reason: redactSensitiveResponseText(postflight.reason) ?? "",
      ...(postflight.revisedText ? { revisedText: redactSensitiveResponseText(postflight.revisedText) ?? "" } : {})
    };
    return { draft: { ...draft, content, safety, postflightSafety }, source: "model" as const };
  } catch (error) {
    if (provider && provider.name !== "mock") {
      await recordModelUsage({
        userId: companion.userId, companionId: companion.id, conversationId: companion.conversationId,
        purpose: "proactive_draft", provider: provider.name, status: "error",
        errorKind: error instanceof LlmProviderError ? error.details.kind : "provider_response",
        latencyMs: Date.now() - startedAt
      });
    }
    return { draft, source: "template" as const };
  }
}
