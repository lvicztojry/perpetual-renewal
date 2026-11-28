export const memoryStatuses = ["PENDING", "ACTIVE", "ARCHIVED", "DELETED"] as const;

export type MemoryStatus = (typeof memoryStatuses)[number];

export const memoryTypes = [
  "USER_FACT",
  "RELATIONSHIP_EVENT",
  "COMPANION_PROFILE",
  "EMOTIONAL_PREFERENCE"
] as const;

export type MemoryType = (typeof memoryTypes)[number];

export type MemoryRecord = {
  id: string;
  userId?: string;
  companionId?: string;
  sourceMessageId?: string | null;
  type: MemoryType;
  status: MemoryStatus;
  content: string;
  confidence: number;
  createdAt?: Date;
  updatedAt?: Date;
};

export type MemoryCandidate = {
  sourceMessageId?: string;
  type: MemoryType;
  status: "PENDING";
  content: string;
  confidence: number;
};

export type MemoryStatusTarget = Exclude<MemoryStatus, "PENDING">;

export function isMemoryStatus(value: string): value is MemoryStatus {
  return memoryStatuses.includes(value as MemoryStatus);
}

export function isMemoryStatusTarget(value: string): value is MemoryStatusTarget {
  return value === "ACTIVE" || value === "ARCHIVED" || value === "DELETED";
}

export function isMemoryType(value: string): value is MemoryType {
  return memoryTypes.includes(value as MemoryType);
}

export function canTransitionMemoryStatus(from: MemoryStatus, to: MemoryStatus): boolean {
  if (from === to) return true;
  if (from === "DELETED") return false;

  if (to === "DELETED") return true;
  if (from === "PENDING") return to === "ACTIVE" || to === "ARCHIVED";
  if (from === "ACTIVE") return to === "ARCHIVED";
  if (from === "ARCHIVED") return to === "ACTIVE";

  return false;
}

