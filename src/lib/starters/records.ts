import { STARTER_CHARACTERS, STARTER_GROUP_BACKGROUND } from "./catalog";
import type { CompanionRecord, ConversationRecord, MessageRecord, RelationshipStateRecord } from "@/lib/renewal/types";
import type { StoredGroup } from "@/lib/groups/repository";
import { DEFAULT_SETTINGS } from "@/lib/groups/validation";

export type StarterRecords = {
  companions: CompanionRecord[]; conversations: ConversationRecord[];
  messages: MessageRecord[]; relationshipStates: RelationshipStateRecord[]; group: StoredGroup;
};

/** Namespace is an owner-derived hash. No user history or user memories are seeded. */
export function buildStarterRecords(userId: string, namespace: string, now: string): StarterRecords {
  const companions: CompanionRecord[] = STARTER_CHARACTERS.map(character => ({
    id: namespace + "-" + character.key, userId, name: character.name,
    relationshipKind: "ORIGINAL_CHARACTER", customKind: "留灯会 · " + character.tagline,
    userAddress: "你", companionAddress: character.name, personality: [...character.personality],
    speakingStyle: character.speakingStyle, background: character.background,
    boundaries: "尊重对方不回复、不同意和不想聊的选择。只知道自己的设定、可见聊天与获准使用的记忆；示例不代表发生过。不预设恋爱或亲密关系，不声称替用户完成现实行动。",
    immersionEnabled: true, proactiveMessagesEnabled: false,
    proactiveFrequencyPreset: "24h", proactiveFrequencyMinutes: 1440, createdAt: now, updatedAt: now
  }));
  const conversations = companions.map(c => ({
    id: c.id + "-chat", userId, companionId: c.id, title: "和 " + c.name + " 的对话",
    createdAt: now, updatedAt: now, lastMessageAt: now
  }));
  const messages: MessageRecord[] = companions.map((c, index) => ({
    id: c.id + "-hello", conversationId: conversations[index].id, role: "assistant",
    content: STARTER_CHARACTERS[index].greeting, metadata: { provider: "starter", model: "starter" }, createdAt: now
  }));
  const relationshipStates: RelationshipStateRecord[] = companions.map(c => ({
    id: c.id + "-state", companionId: c.id, familiarityScore: 0, closenessScore: 0,
    recentEmotion: null, importantEvents: [], lastInteractionAt: null,
    explanation: "初次认识，关系随真实交流逐渐形成。", createdAt: now, updatedAt: now
  }));
  const group: StoredGroup = {
    id: namespace + "-liudeng", userId, name: "留灯会", background: STARTER_GROUP_BACKGROUND,
    members: companions.map(c => ({ companionId: c.id, joinedAt: now, allowPrivateMemories: false,
      proactiveEnabled: true, relationship: "留灯会朋友；具体交情见群背景" })),
    messages: [], memories: [], settings: { ...DEFAULT_SETTINGS }, revision: 1, turn: 0,
    lastActivityAt: now, lastProactiveAt: null, createdAt: now, updatedAt: now,
    _control: { plan: null, deliveries: {}, autoRounds: 0 }
  };
  return { companions, conversations, messages, relationshipStates, group };
}
