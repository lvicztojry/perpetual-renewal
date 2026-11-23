// Tag every value, so user-authored JSON cannot be confused with a Map/Date tag.
export function encode(value: unknown): unknown {
  if (value === undefined) return ["u"];
  if (value instanceof Date) return ["d", value.toISOString()];
  if (value instanceof Map) return ["m", [...value].map(([key, item]) => [encode(key), encode(item)])];
  if (Array.isArray(value)) return ["a", value.map(encode)];
  if (value !== null && typeof value === "object") return ["o", Object.entries(value).map(([key, item]) => [key, encode(item)])];
  return ["v", value];
}
export function decode(input: unknown): unknown {
  if (!Array.isArray(input)) throw new Error("Invalid local data.");
  const [tag, value] = input;
  switch (tag) {
    case "u": return undefined;
    case "v": return value;
    case "d": return new Date(value);
    case "a": return value.map(decode);
    case "m": return new Map(value.map(([key, item]: unknown[]) => [decode(key), decode(item)]));
    case "o": return Object.fromEntries(value.map(([key, item]: [string, unknown]) => [key, decode(item)]));
    default: throw new Error("Unsupported local data tag.");
  }
}
export const stateKeys = ["renewalStore", "renewalGroupStore", "renewalDreamStore", "renewalJourneyStore", "renewalMemoryRevisionStore", "renewalMessageReadReceipts", "renewalCredentialStore", "renewalSafetyEventStore", "renewalUsageStore", "__perpetualRenewalFallbackProfiles"] as const;
const globals = globalThis as unknown as Record<string, unknown>;
export function snapshot() { return encode(Object.fromEntries(stateKeys.map(key => [key, globals[key]]))); }
export function hydrate(value: unknown) {
  const restored = decode(value) as Record<string, unknown>;
  for (const key of stateKeys) globals[key] = restored[key];
}
export function emptyState(newAccountId?: string) {
  return encode({
    renewalStore: { companions: [], conversations: [], messages: [], memories: [], proactiveMessages: [], relationshipStates: [] },
    renewalGroupStore: new Map(), renewalDreamStore: new Map(), renewalMemoryRevisionStore: [],
    renewalJourneyStore: new Map(newAccountId ? [[newAccountId, { version: 1, step: "awakening", status: "active", companionId: null, revision: 0 }]] : []),
    renewalMessageReadReceipts: new Map(), renewalCredentialStore: new Map(), renewalSafetyEventStore: { events: [] },
    renewalUsageStore: { logs: [] }, __perpetualRenewalFallbackProfiles: new Map()
  });
}
