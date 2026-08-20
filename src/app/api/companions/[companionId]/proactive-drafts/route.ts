import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import {
  createProactiveDrafts,
  checkProactiveContextSafety,
  normalizeProactiveFrequency,
  type CompanionProfile as ProactiveCompanionProfile,
  type RelationshipStateSnapshot
} from "@/lib/relationship";
import { createRenewalRepository } from "@/lib/renewal/repository";
import type {
  CompanionProfile as RenewalCompanionProfile,
  ProactiveMessageRecord,
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
};

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ companionId: string }> }
) {
  const { companionId } = await context.params;
  const body = await readDraftRequest(request);
  const forceGenerate = body.force || body.frequencyHours === 0 || body.frequencyMinutes === 0;
  const requestedFrequencyMinutes = readFrequencyMinutes(body);
  const session = await getCurrentSession();
  const repository = createRenewalRepository();
  const [companion, profile] = await Promise.all([
    repository.getCompanion(session.userId, companionId),
    getUserProfile(session.userId)
  ]);

  if (!companion) {
    return NextResponse.json({ error: "Companion not found." }, { status: 404 });
  }

  const proactiveCompanion = toProactiveCompanion(companion);
  const state = toRelationshipSnapshot(companion.relationshipState);
  const safety = checkProactiveContextSafety({
    lastUserMessage: body.lastUserMessage,
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

  const drafts = createProactiveDrafts({
      companion: proactiveCompanion,
      state,
      lastUserMessage: body.lastUserMessage,
      proactiveMessagesEnabled:
        body.proactiveMessagesEnabled ??
        (companion.proactiveMessagesEnabled && profile.proactiveMessagesEnabled),
      frequencyPreset,
      frequencyMinutes,
      force: forceGenerate,
      now: new Date()
  });
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
  for (const draft of drafts) {
    records.push(
      await repository.createProactiveMessage(session.userId, companion.id, {
        kind: draft.kind,
        content: draft.content,
        reason: draft.reason,
        safety: {
          result: draft.safety,
          ...(draft.preflightSafety ? { preflight: draft.preflightSafety } : {}),
          ...(draft.postflightSafety ? { postflight: draft.postflightSafety } : {}),
          ...(draft.frequency ? { frequency: draft.frequency } : {}),
          ...(draft.nextCandidateAt ? { nextCandidateAt: draft.nextCandidateAt } : {})
        },
        status: "draft",
        scheduledAt: draft.scheduledAt ?? null
      })
    );
  }

  return NextResponse.json({
    data: records.map((record) => ({
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
      persistence: repository.persistence,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    })),
    safety,
    persistence: repository.persistence,
    frequency,
    status: "draft",
    generatedCount: drafts.length,
    savedCount: records.length
  });
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

async function readDraftRequest(request: Request): Promise<ProactiveDraftRequest> {
  try {
    const body = (await request.json()) as ProactiveDraftRequest;
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
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
