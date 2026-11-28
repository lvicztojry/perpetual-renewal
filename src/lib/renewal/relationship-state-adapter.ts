import {
  updateRelationshipState as evolveRelationshipState,
  type RelationshipStateSnapshot
} from "@/lib/relationship";
import type { MessageRecord, RelationshipStateRecord, UpdateRelationshipStateInput } from "./types";

export function updateRelationshipRecordAfterMessage(
  current: RelationshipStateRecord,
  message: MessageRecord
): UpdateRelationshipStateInput {
  const update = evolveRelationshipState(toRelationshipSnapshot(current), {
    userMessage: message.content,
    sourceMessageId: message.id,
    createdAt: message.createdAt
  });

  return {
    familiarityScore: update.state.familiarityScore,
    closenessScore: update.state.closenessScore,
    recentEmotion: update.state.recentEmotion ?? null,
    importantEvents: update.state.importantEvents.map((event) => event.title).slice(0, 12),
    lastInteractionAt: update.state.lastInteractionAt ?? null,
    explanation: update.state.explanation
  };
}

function toRelationshipSnapshot(state: RelationshipStateRecord): RelationshipStateSnapshot {
  return {
    companionId: state.companionId,
    familiarityScore: state.familiarityScore,
    closenessScore: state.closenessScore,
    recentEmotion: state.recentEmotion ?? undefined,
    importantEvents: state.importantEvents.map((title, index) => ({
      id: `${state.id}-event-${index}`,
      title,
      explanation: "来自持久化关系状态。"
    })),
    lastInteractionAt: state.lastInteractionAt ?? undefined,
    explanation: state.explanation ?? "来自持久化关系状态。"
  };
}
