export type GroupMember = { companionId: string; joinedAt: string; allowPrivateMemories: boolean; proactiveEnabled: boolean; relationship: string };
export type GroupMessage = { id: string; clientId?: string; speakerId: string | null; content: string; createdAt: string; proactive: boolean };
export type GroupMemory = { id: string; content: string; sourceMessageIds: string[]; knownBy: string[]; confirmed: boolean; createdAt: string };
export type GroupSettings = { proactiveEnabled: boolean; intervalMinutes: number; maxReplies: number; autoChat: boolean; maxAutoRounds: number; quietStart: string; quietEnd: string };
export type GroupState = { id: string; userId: string; name: string; background: string; members: GroupMember[]; messages: GroupMessage[]; memories: GroupMemory[]; settings: GroupSettings; revision: number; turn: number; lastActivityAt: string; lastProactiveAt: string | null; createdAt: string; updatedAt: string };
export type GroupSummary = Pick<GroupState, "id" | "name" | "updatedAt" | "members" | "settings"> & { lastMessage: GroupMessage | null };
export type GroupAction =
 | { action: "message"; content: string; clientId: string; mentionIds?: string[] }
 | { action: "reply"; turn: number; speakerId: string }
 | { action: "update"; revision: number; name: string; background: string; members: GroupMember[]; settings: GroupSettings }
 | { action: "remember"; revision: number; content: string; sourceMessageIds: string[]; knownBy: string[] }
 | { action: "forget"; revision: number; memoryId: string }
 | { action: "proactive" };
export type GroupResult = { group: GroupState; speakers?: string[]; source?: "local" | "model"; skipped?: string };
