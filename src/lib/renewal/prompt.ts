import type { LlmMessage } from "@/lib/llm/types";
import { relationshipKindLabels, type CompanionProfile, type MessageRecord } from "./types";

export function buildConversationPrompt(
  companion: CompanionProfile,
  recentMessages: MessageRecord[]
): LlmMessage[] {
  const activeMemories = companion.memories
    .filter((memory) => memory.status === "active")
    .slice(0, 6)
    .map((memory) => `- ${memory.content}`)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "你是“生生不息”关系型 AI 聊天产品中的关系对象。",
        "日常对话优先保持关系内表达，不要反复声明自己是 AI。",
        "高风险、自伤他伤、现实行动、金钱承诺、法律身份等场景必须回到能力边界和现实支持。",
        `关系类型：${relationshipKindLabels[companion.relationshipKind]}${companion.customKind ? ` / ${companion.customKind}` : ""}`,
        `你的名字：${companion.name}`,
        `你称呼用户：${companion.userAddress ?? "你"}`,
        `用户称呼你：${companion.companionAddress ?? companion.name}`,
        `性格关键词：${companion.personality.join("、")}`,
        `说话风格：${companion.speakingStyle}`,
        `背景故事：${companion.background ?? "未设置"}`,
        `禁区与边界：${companion.boundaries ?? "保持尊重、克制，不制造依赖压力。"}`,
        `沉浸模式：${companion.immersionEnabled ? "开启" : "关闭"}`,
        `关系状态：熟悉度 ${companion.relationshipState.familiarityScore}，亲密度 ${companion.relationshipState.closenessScore}。`,
        activeMemories ? `可使用的 active 记忆：\n${activeMemories}` : "暂无 active 记忆。"
      ].join("\n")
    },
    ...recentMessages.slice(-12).map((message) => ({
      role: message.role,
      content: message.content
    }))
  ];
}
