const names = (values: string[]) => Object.fromEntries(values.map(value => [value, value]));
export const MemoryStatus = names(["PENDING", "ACTIVE", "ARCHIVED", "DELETED"]);
export const MemoryType = names(["USER_FACT", "RELATIONSHIP_EVENT", "COMPANION_PROFILE", "EMOTIONAL_PREFERENCE"]);
export const MessageRole = names(["USER", "ASSISTANT", "SYSTEM"]);
export const ProactiveMessageKind = names(["DAILY_GREETING", "LAST_CONVERSATION_FOLLOWUP", "ANNIVERSARY", "EMOTION_CARE", "PLAYFUL_MISS_YOU"]);
export const ProactiveMessageStatus = names(["DRAFT", "SENT", "DISMISSED", "BLOCKED"]);
export const RelationshipKind = names(["REAL_PERSON_SUBSTITUTE", "MEMORIAL", "EX_PARTNER", "LOVER", "FRIEND", "FAMILY", "MENTOR", "PUBLIC_FIGURE_IMAGINED", "FICTIONAL_CHARACTER", "ORIGINAL_CHARACTER", "CUSTOM"]);
// Some shared PostgreSQL modules construct SQL constants on import. These are inert tokens;
// actual database access is rejected by prisma.ts and never selected by the local repositories.
export const Prisma = {
  JsonNull: null, DbNull: null, TransactionIsolationLevel: { Serializable: "Serializable" },
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Object.freeze({ strings, values }),
  raw: (value: string) => Object.freeze({ raw: value }),
  join: (values: unknown[]) => Object.freeze({ values })
};
