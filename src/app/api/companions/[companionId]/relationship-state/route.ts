import { privateJson } from "@/lib/http/private-response";
import {
  updateRelationshipState,
  type RelationshipSignal,
  type RelationshipStateSnapshot
} from "@/lib/relationship";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { createRenewalRepository } from "@/lib/renewal/repository";
import type { RelationshipStateRecord } from "@/lib/renewal/types";

type RelationshipStateRequest = {
  current?: RelationshipStateSnapshot;
  signal?: RelationshipSignal;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ companionId: string }> }
) {
  const { companionId } = await context.params;
  const session = await getCurrentSession();
  const repository = createRenewalRepository();
  const companion = await repository.getCompanion(session.userId, companionId);

  if (!companion) {
    return privateJson({ error: "Companion not found." }, { status: 404 });
  }

  return privateJson({
    data: toRelationshipSnapshot(companion.relationshipState),
    persistence: repository.persistence
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ companionId: string }> }
) {
  const { companionId } = await context.params;
  let body: RelationshipStateRequest;

  try {
    body = await readRequest(request);
  } catch (error) {
    return privateJson(
      { error: jsonErrorMessage(error, "Failed to update relationship state.") },
      { status: 400 }
    );
  }

  const session = await getCurrentSession();
  const repository = createRenewalRepository();
  const companion = await repository.getCompanion(session.userId, companionId);

  if (!companion) {
    return privateJson({ error: "Companion not found." }, { status: 404 });
  }

  const current = toRelationshipSnapshot(companion.relationshipState);
  const signal = normalizeSignal(body.signal);
  const update = updateRelationshipState(current, signal);
  const persisted = await repository.updateRelationshipState(
    session.userId,
    companionId,
    toRelationshipStateInput(update.state)
  );

  if (!persisted) {
    return privateJson({ error: "Companion not found." }, { status: 404 });
  }

  return privateJson({
    data: {
      ...update,
      state: toRelationshipSnapshot(persisted)
    },
    persistence: repository.persistence
  });
}

async function readRequest(request: Request): Promise<RelationshipStateRequest> {
  return (await readJsonObject(request)) as RelationshipStateRequest;
}

function normalizeSignal(signal: RelationshipStateRequest["signal"]): RelationshipSignal {
  if (!signal || typeof signal !== "object") {
    return {
      userMessage: "",
      createdAt: new Date().toISOString()
    };
  }

  return {
    userMessage: typeof signal.userMessage === "string" ? signal.userMessage : "",
    assistantMessage:
      typeof signal.assistantMessage === "string" ? signal.assistantMessage : undefined,
    sourceMessageId:
      typeof signal.sourceMessageId === "string" ? signal.sourceMessageId : undefined,
    createdAt: typeof signal.createdAt === "string" ? signal.createdAt : new Date().toISOString()
  };
}

function toRelationshipStateInput(state: RelationshipStateSnapshot) {
  return {
    familiarityScore: state.familiarityScore,
    closenessScore: state.closenessScore,
    recentEmotion: state.recentEmotion ?? null,
    importantEvents: state.importantEvents.map((event) => event.title).slice(0, 12),
    lastInteractionAt: state.lastInteractionAt ?? null,
    explanation: state.explanation
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
