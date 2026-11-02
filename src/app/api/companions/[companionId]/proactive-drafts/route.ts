import { privateJson } from "@/lib/http/private-response";
import { createHash } from "node:crypto";
import { personalizeProactiveDraft } from "@/lib/relationship/proactive-model";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";
import {
  createProactiveDraftPlan,
  checkProactiveContextSafety,
  normalizeProactiveFrequency,
  type CompanionProfile as ProactiveCompanionProfile,
  type RelationshipStateSnapshot
} from "@/lib/relationship";
import { createRenewalRepository } from "@/lib/renewal/repository";
import type {
  CompanionProfile as RenewalCompanionProfile,
  ProactiveMessageRecord,
  MessageRecord,
  RelationshipStateRecord
} from "@/lib/renewal/types";
import { getUserProfile } from "@/lib/users/profile";

type ProactiveDraftRequest = {
  lastUserMessage?: string;
  proactiveMessagesEnabled?: boolean;
  frequencyHours?: number;
  frequencyMinutes?: number;
  frequencyPreset?: string;
  customValue?: number;
  customUnit?: string;
  force?: boolean;
  maxDrafts?: number;
};

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ companionId: string }> }
) {
  try {
    const { companionId } = await context.params;
    const session = await getCurrentSession();
    const repository = createRenewalRepository();
    const companion = await repository.getCompanion(session.userId, companionId);

    if (!companion) {
      return privateJson({ error: "Companion not found." }, { status: 404 });
    }

    const records = await repository.listProactiveMessages(session.userId, companion.id);

    return privateJson({
      data: records.map(toProactiveDraftResponse),
      persistence: repository.persistence
    });
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "workspace");
    if (persistenceError) return persistenceError;

    throw error;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ companionId: string }> }
) {
  const { companionId } = await context.params;
  let body: ProactiveDraftRequest;

  try {
    body = await readDraftRequest(request);
  } catch (error) {
    return privateJson(
      { error: jsonErrorMessage(error, "Failed to create proactive drafts.") },
      { status: 400 }
    );
  }

  try {
    const forceGenerate = body.force || body.frequencyHours === 0 || body.frequencyMinutes === 0;
    const requestedFrequencyMinutes = readFrequencyMinutes(body);
    const session = await getCurrentSession();
    const repository = createRenewalRepository();
    const [companion, profile, proactiveMessages] = await Promise.all([
      repository.getCompanion(session.userId, companionId),
      getUserProfile(session.userId),
      repository.listProactiveMessages(session.userId, companionId)
    ]);

    if (!companion) {
      return privateJson({ error: "Companion not found." }, { status: 404 });
    }

    const history = await repository.listMessages(session.userId, companion.conversationId);
    const persistedLastUserMessage = [...history].reverse().find((message) => message.role === "user")?.content;
    const lastUserMessage = forceGenerate ? body.lastUserMessage ?? persistedLastUserMessage : persistedLastUserMessage;
    const proactiveCompanion = toProactiveCompanion(companion);
    const snapshot = toRelationshipSnapshot(companion.relationshipState);
    const state = forceGenerate
      ? snapshot
      : withProactiveDraftAnchor({ ...snapshot, lastInteractionAt: snapshot.lastInteractionAt ?? companion.createdAt }, proactiveMessages);
    const safety = checkProactiveContextSafety({
      lastUserMessage,
      companionInstruction: [
        proactiveCompanion.personality.join("，"),
        proactiveCompanion.speakingStyle,
        proactiveCompanion.background,
        proactiveCompanion.boundaries
      ]
        .filter(Boolean)
        .join("\n")
    });
    const frequencyPreset =
      body.frequencyPreset ?? (requestedFrequencyMinutes ? "custom" : companion.proactiveFrequencyPreset);
    const frequencyMinutes =
      requestedFrequencyMinutes ??
      companion.proactiveFrequencyMinutes ??
      profile.proactiveFrequencyHours * 60;

    const plan = createProactiveDraftPlan({
      companion: proactiveCompanion,
      state,
      lastUserMessage,
      proactiveMessagesEnabled: companion.proactiveMessagesEnabled && profile.proactiveMessagesEnabled && body.proactiveMessagesEnabled !== false,
      frequencyPreset,
      frequencyMinutes,
      force: forceGenerate,
      now: new Date()
    });
    const maxDrafts = normalizeMaxDrafts(body.maxDrafts);
    const drafts = plan.drafts.slice(0, forceGenerate ? maxDrafts : 1);
    const draftLimitReached = plan.drafts.length > drafts.length;
    const frequency = normalizeProactiveFrequency(
      {
        preset: frequencyPreset,
        everyMinutes: frequencyMinutes,
        customValue: body.customValue,
        customUnit: body.customUnit
      },
      profile.proactiveFrequencyHours * 60
    );

    const records: ProactiveMessageRecord[] = [];
    const deliveredMessages: MessageRecord[] = [];
    for (const candidate of drafts) {
      const generated = forceGenerate ? { draft: candidate, source: "template" } : await personalizeProactiveDraft(companion, candidate, history);
      const draft = generated.draft;
      let record = await repository.createProactiveMessage(session.userId, companion.id, {
          kind: draft.kind,
          content: draft.content,
          reason: draft.reason,
          safety: {
            result: draft.safety,
            generator: generated.source,
            ...(draft.preflightSafety ? { preflight: draft.preflightSafety } : {}),
            ...(draft.postflightSafety ? { postflight: draft.postflightSafety } : {}),
            ...(draft.frequency ? { frequency: draft.frequency } : {}),
            ...(draft.nextCandidateAt ? { nextCandidateAt: draft.nextCandidateAt } : {})
          },
          status: "draft",
          scheduledAt: draft.scheduledAt ?? null,
          deliveryKey: forceGenerate ? null : createHash("sha256").update(`${companion.id}:${plan.schedule.candidateAt}`).digest("hex")
        });
      if (!forceGenerate) {
        const delivered = await repository.deliverProactiveMessage(session.userId, record.id, { automatic: true });
        if (delivered) {
          record = delivered.proactiveMessage;
          deliveredMessages.push(delivered.message);
        }
      }
      records.push(record);
    }

    return privateJson({
      data: records.map(toProactiveDraftResponse),
      safety,
      persistence: repository.persistence,
      frequency,
      schedule: plan.schedule,
      skippedReason: plan.skippedReason ?? null,
      maxDrafts,
      draftLimitReached,
      status: deliveredMessages.length ? "sent" : "draft",
      deliveredMessages,
      deliveredCount: deliveredMessages.length,
      generatedCount: plan.drafts.length,
      savedCount: records.length
    });
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "renewal");
    if (persistenceError) return persistenceError;

    throw error;
  }
}

function toProactiveDraftResponse(record: ProactiveMessageRecord) {
  return {
    id: record.id,
    companionId: record.companionId,
    kind: record.kind,
    content: record.content,
    reason: record.reason,
    scheduledAt: record.scheduledAt,
    nextCandidateAt:
      typeof record.safety?.nextCandidateAt === "string" ? record.safety.nextCandidateAt : null,
    frequency: record.safety?.frequency ?? null,
    safety: record.safety?.result ?? null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function readFrequencyMinutes(body: ProactiveDraftRequest) {
  if (typeof body.frequencyMinutes === "number" && body.frequencyMinutes > 0) {
    return body.frequencyMinutes;
  }

  if (typeof body.frequencyHours === "number" && body.frequencyHours > 0) {
    return body.frequencyHours * 60;
  }

  if (typeof body.customValue !== "number") {
    return undefined;
  }

  if (body.customUnit === "days") return body.customValue * 1440;
  if (body.customUnit === "hours") return body.customValue * 60;
  return body.customValue;
}

function normalizeMaxDrafts(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

async function readDraftRequest(request: Request): Promise<ProactiveDraftRequest> {
  return (await readJsonObject(request)) as ProactiveDraftRequest;
}

function toProactiveCompanion(companion: RenewalCompanionProfile): ProactiveCompanionProfile {
  return {
    id: companion.id,
    name: companion.name,
    relationshipKind: companion.relationshipKind,
    customKind: companion.customKind ?? undefined,
    userAddress: companion.userAddress ?? undefined,
    companionAddress: companion.companionAddress ?? undefined,
    personality: companion.personality,
    speakingStyle: companion.speakingStyle,
    background: companion.background ?? undefined,
    boundaries: companion.boundaries ?? undefined,
    immersionEnabled: companion.immersionEnabled
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
      explanation: "来自关系状态记录。"
    })),
    lastInteractionAt: state.lastInteractionAt ?? undefined,
    explanation: state.explanation ?? "来自持久化关系状态。"
  };
}

function withProactiveDraftAnchor(
  state: RelationshipStateSnapshot,
  proactiveMessages: ProactiveMessageRecord[]
): RelationshipStateSnapshot {
  const latestProactiveAt = latestDate(
    proactiveMessages.flatMap((message) => [message.scheduledAt, message.createdAt])
  );
  const latestAnchor = latestDate([state.lastInteractionAt, latestProactiveAt?.toISOString()]);

  return {
    ...state,
    lastInteractionAt: latestAnchor?.toISOString() ?? state.lastInteractionAt
  };
}

function latestDate(values: Array<string | null | undefined>) {
  const dates = values
    .map((value) => (value ? new Date(value) : null))
    .filter((value): value is Date => !!value && !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return dates[0];
}
