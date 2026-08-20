import { getUserProfile } from "@/lib/users/profile";
import { createRenewalRepository } from "@/lib/renewal/repository";
import type {
  CompanionProfile as RenewalCompanionProfile,
  ProactiveMessageRecord,
  RelationshipStateRecord
} from "@/lib/renewal/types";
import { createProactiveDrafts } from "./proactive";
import type {
  CompanionProfile as ProactiveCompanionProfile,
  RelationshipStateSnapshot
} from "./types";

export type ProactiveSchedulerInput = {
  userId?: string;
  dryRun?: boolean;
  limit?: number;
  maxDrafts?: number;
  now?: Date;
};

export type ProactiveSchedulerResult = {
  dryRun: boolean;
  scope: "current-user" | "all";
  persistence: "prisma" | "memory";
  scannedCount: number;
  eligibleCount: number;
  generatedCount: number;
  savedCount: number;
  skippedCount: number;
  maxDrafts: number;
  results: Array<{
    companionId: string;
    companionName: string;
    due: boolean;
    generatedCount: number;
    savedCount: number;
    reason: string;
    nextCandidateAt?: string;
  }>;
};

const DEFAULT_SCHEDULER_LIMIT = 20;
const MAX_SCHEDULER_LIMIT = 100;
const DEFAULT_SCHEDULER_MAX_DRAFTS = 50;
const MAX_SCHEDULER_MAX_DRAFTS = 200;

export async function runProactiveScheduler(
  input: ProactiveSchedulerInput = {}
): Promise<ProactiveSchedulerResult> {
  const repository = createRenewalRepository();
  const now = input.now ?? new Date();
  const dryRun = input.dryRun ?? true;
  const limit = normalizeLimit(input.limit);
  const maxDrafts = normalizeMaxDrafts(input.maxDrafts);
  const companions = (await repository.listCompanionsForProactive(input.userId)).slice(0, limit);
  const results: ProactiveSchedulerResult["results"] = [];
  let generatedCount = 0;
  let savedCount = 0;
  let eligibleCount = 0;

  for (const companion of companions) {
    const remainingDrafts = maxDrafts - generatedCount;
    if (remainingDrafts <= 0) {
      results.push({
        companionId: companion.id,
        companionName: companion.name,
        due: false,
        generatedCount: 0,
        savedCount: 0,
        reason: "本轮主动回响生成上限已达到。"
      });
      continue;
    }

    const profile = await getUserProfile(companion.userId);
    const proactiveEnabled = companion.proactiveMessagesEnabled && profile.proactiveMessagesEnabled;

    if (!proactiveEnabled) {
      results.push({
        companionId: companion.id,
        companionName: companion.name,
        due: false,
        generatedCount: 0,
        savedCount: 0,
        reason: "主动回响已关闭。"
      });
      continue;
    }

    const [messages, proactiveMessages] = await Promise.all([
      repository.listMessages(companion.userId, companion.conversationId),
      repository.listProactiveMessages(companion.userId, companion.id)
    ]);
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const state = withSchedulerAnchor(
      toRelationshipSnapshot(companion.relationshipState),
      proactiveMessages
    );
    const drafts = createProactiveDrafts({
      companion: toProactiveCompanion(companion),
      state,
      lastUserMessage: lastUserMessage?.content,
      proactiveMessagesEnabled: true,
      frequencyPreset: companion.proactiveFrequencyPreset,
      frequencyMinutes: companion.proactiveFrequencyMinutes || profile.proactiveFrequencyHours * 60,
      force: false,
      now
    });

    const cappedDrafts = drafts.slice(0, remainingDrafts);

    if (!cappedDrafts.length) {
      results.push({
        companionId: companion.id,
        companionName: companion.name,
        due: false,
        generatedCount: 0,
        savedCount: 0,
        reason: "尚未到达主动回响候选时间。"
      });
      continue;
    }

    eligibleCount += 1;
    generatedCount += cappedDrafts.length;
    let companionSavedCount = 0;

    if (!dryRun) {
      for (const draft of cappedDrafts) {
        await repository.createProactiveMessage(companion.userId, companion.id, {
          kind: draft.kind,
          content: draft.content,
          reason: draft.reason,
          safety: {
            result: draft.safety,
            ...(draft.preflightSafety ? { preflight: draft.preflightSafety } : {}),
            ...(draft.postflightSafety ? { postflight: draft.postflightSafety } : {}),
            ...(draft.frequency ? { frequency: draft.frequency } : {}),
            ...(draft.nextCandidateAt ? { nextCandidateAt: draft.nextCandidateAt } : {}),
            scheduler: {
              dryRun,
              generatedAt: now.toISOString()
            }
          },
          status: "draft",
          scheduledAt: draft.scheduledAt ?? null
        });
        companionSavedCount += 1;
      }
    }

    savedCount += companionSavedCount;
    results.push({
      companionId: companion.id,
      companionName: companion.name,
      due: true,
      generatedCount: cappedDrafts.length,
      savedCount: companionSavedCount,
      reason:
        cappedDrafts.length < drafts.length
          ? dryRun
            ? "到期，但已按本轮上限裁剪；dry-run 未保存草稿。"
            : "到期，但已按本轮上限裁剪并保存站内草稿。"
          : dryRun
            ? "到期，dry-run 未保存草稿。"
            : "到期，已保存站内草稿。",
      nextCandidateAt: cappedDrafts[0]?.nextCandidateAt
    });
  }

  return {
    dryRun,
    scope: input.userId ? "current-user" : "all",
    persistence: repository.persistence,
    scannedCount: companions.length,
    eligibleCount,
    generatedCount,
    savedCount,
    skippedCount: companions.length - eligibleCount,
    maxDrafts,
    results
  };
}

function normalizeLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SCHEDULER_LIMIT;
  return Math.min(MAX_SCHEDULER_LIMIT, Math.max(1, Math.floor(value)));
}

function normalizeMaxDrafts(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SCHEDULER_MAX_DRAFTS;
  return Math.min(MAX_SCHEDULER_MAX_DRAFTS, Math.max(1, Math.floor(value)));
}

function withSchedulerAnchor(
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
