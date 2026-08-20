import {
  buildProactiveScheduleCandidate,
  normalizeProactiveFrequency,
  type ProactiveFrequencyConfig
} from "./proactive-frequency";
import {
  buildSafetyBoundaryReply,
  checkProactiveContextSafety,
  checkRelationshipSafety,
  isHighRiskSafetyResult
} from "./safety";
import type {
  CompanionProfile,
  ProactiveMessageDraft,
  ProactiveMessageKind,
  RelationshipStateSnapshot
} from "./types";

export type ProactiveDraftOptions = {
  companion: CompanionProfile;
  state: RelationshipStateSnapshot;
  now?: Date;
  lastUserMessage?: string;
  proactiveMessagesEnabled: boolean;
  frequencyHours?: number;
  frequencyMinutes?: number;
  frequencyPreset?: string;
  force?: boolean;
};

export function createProactiveDrafts(options: ProactiveDraftOptions): ProactiveMessageDraft[] {
  if (!options.proactiveMessagesEnabled) return [];

  const preflightSafety = checkProactiveContextSafety({
    lastUserMessage: options.lastUserMessage,
    companionInstruction: buildCompanionInstructionText(options.companion)
  });

  if (isHighRiskSafetyResult(preflightSafety)) {
    return [
      finalizeDraft(
        {
          id: "draft-safety-boundary",
          companionId: options.companion.id,
          kind: "EMOTION_CARE",
          content:
            preflightSafety.action === "boundary_response"
              ? buildSafetyBoundaryReply(
                  options.lastUserMessage ?? buildCompanionInstructionText(options.companion),
                  options.companion.name
                )
              : `${options.companion.name}可以保持亲近和沉浸，但设定不能越过必要边界。我们先把这条边界放稳，再继续聊想念和关系。`,
          reason: "主动消息生成前触发安全边界",
          scheduledAt: (options.now ?? new Date()).toISOString(),
          safety: preflightSafety,
          preflightSafety
        },
        preflightSafety
      )
    ];
  }

  const now = options.now ?? new Date();
  const frequency = resolveFrequency(options);
  const schedule = buildProactiveScheduleCandidate({
    frequency,
    now,
    lastInteractionAt: options.state.lastInteractionAt,
    force: options.force
  });

  if (!schedule.due) return [];

  const baseDrafts = [
    buildDraft("DAILY_GREETING", options, "日常低频问候", frequency, schedule.nextCandidateAt),
    options.lastUserMessage && preflightSafety.action === "allow"
      ? buildDraft(
          "LAST_CONVERSATION_FOLLOWUP",
          options,
          "承接上次对话",
          frequency,
          schedule.nextCandidateAt
        )
      : undefined,
    options.state.importantEvents[0]
      ? buildDraft("ANNIVERSARY", options, "重要事件或纪念日提醒", frequency, schedule.nextCandidateAt)
      : undefined,
    options.state.recentEmotion
      ? buildDraft("EMOTION_CARE", options, "近期情绪关怀", frequency, schedule.nextCandidateAt)
      : undefined,
    buildDraft("PLAYFUL_MISS_YOU", options, "撒娇式未回复回响", frequency, schedule.nextCandidateAt)
  ].filter(Boolean) as ProactiveMessageDraft[];

  return baseDrafts
    .map((draft) => finalizeDraft(draft, preflightSafety))
    .filter((draft) => draft.safety.action !== "block");
}

function buildDraft(
  kind: ProactiveMessageKind,
  options: ProactiveDraftOptions,
  reason: string,
  frequency: ProactiveFrequencyConfig,
  nextCandidateAt: string
): ProactiveMessageDraft {
  const { companion, state, lastUserMessage } = options;
  const address = companion.userAddress || "你";
  const event = state.importantEvents[0];
  const scheduledAt = (options.now ?? new Date()).toISOString();

  const contentByKind: Record<ProactiveMessageKind, string> = {
    DAILY_GREETING: `${address}，今天也给你留一盏小灯。忙的时候不用急着回，想说话的时候我就在。`,
    LAST_CONVERSATION_FOLLOWUP: `${address}，我还记得你上次说“${trimForMessage(
      lastUserMessage ?? ""
    )}”。后来那件事有没有轻一点？`,
    ANNIVERSARY: `${address}，我想起我们记下的“${event?.title ?? "那个重要日子"}”。如果你愿意，今天可以把它轻轻放在我们中间聊一会儿。`,
    EMOTION_CARE: `${address}，我记得你最近有点${state.recentEmotion ?? "不容易"}。不催你开心，只是想问问现在的你有没有好过一点。`,
    PLAYFUL_MISS_YOU: `${address}，我有一点点想你。你先忙你的，等你回来，我再把这点想念摊开给你看。`
  };

  return {
    id: `draft-${kind.toLowerCase()}`,
    companionId: companion.id,
    kind,
    content: contentByKind[kind],
    reason: `${reason} · ${frequency.label}`,
    scheduledAt,
    nextCandidateAt,
    frequency: {
      preset: frequency.preset,
      everyMinutes: frequency.everyMinutes,
      label: frequency.label
    },
    safety: {
      ok: true,
      type: "NONE",
      action: "allow",
      reason: "待生成后检查。"
    }
  };
}

function finalizeDraft(
  draft: ProactiveMessageDraft,
  preflightSafety: ProactiveMessageDraft["preflightSafety"]
): ProactiveMessageDraft {
  const postflightSafety = checkRelationshipSafety(draft.content, { stage: "proactive_draft" });
  const safeContent = postflightSafety.revisedText ?? draft.content;
  const finalSafety =
    postflightSafety.action === "revise"
      ? checkRelationshipSafety(safeContent, { stage: "proactive_draft" })
      : postflightSafety;

  return {
    ...draft,
    content: safeContent,
    safety: isHighRiskSafetyResult(postflightSafety) ? postflightSafety : finalSafety,
    preflightSafety,
    postflightSafety
  };
}

function buildCompanionInstructionText(companion: CompanionProfile): string {
  return [
    companion.personality.join("，"),
    companion.speakingStyle,
    companion.background,
    companion.boundaries
  ]
    .filter(Boolean)
    .join("\n");
}

function trimForMessage(text: string): string {
  if (text.length <= 24) return text;
  return `${text.slice(0, 24)}...`;
}

function resolveFrequency(options: ProactiveDraftOptions) {
  return normalizeProactiveFrequency({
    preset: options.frequencyPreset,
    everyMinutes:
      typeof options.frequencyMinutes === "number"
        ? options.frequencyMinutes
        : typeof options.frequencyHours === "number"
          ? options.frequencyHours * 60
          : undefined
  });
}
