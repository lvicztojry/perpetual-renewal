import {
  canTransitionMemoryStatus,
  type MemoryRecord,
  type MemoryStatus,
  type MemoryStatusTarget
} from "./types";

export function getActiveMemoriesForPrompt(memories: MemoryRecord[]): MemoryRecord[] {
  return memories.filter((memory) => memory.status.toLowerCase() === "active");
}

export function transitionMemory(
  memory: MemoryRecord,
  nextStatus: MemoryStatusTarget,
  nextContent?: string
): MemoryRecord {
  assertMemoryTransition(memory.status, nextStatus);

  return {
    ...memory,
    status: nextStatus,
    content: nextContent?.trim() || memory.content,
    updatedAt: new Date()
  };
}

export function assertMemoryTransition(from: MemoryStatus, to: MemoryStatus) {
  if (!canTransitionMemoryStatus(from, to)) {
    throw new Error(`Invalid memory status transition: ${from} -> ${to}`);
  }
}
