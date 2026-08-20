import type {
  ImportantEvent,
  RelationshipSignal,
  RelationshipStateSnapshot,
  RelationshipStateUpdate
} from "./types";

const positiveEmotionPatterns = [/开心|高兴|期待|安心|喜欢|想你|想见|谢谢/];
const lowEmotionPatterns = [/难过|崩溃|累|失眠|害怕|孤独|想哭|见不到|低落|焦虑/];
const eventPatterns = [/生日|纪念日|约定|第一次|见面|离开|去世|分开|考试|面试|搬家/];

export function createInitialRelationshipState(
  companionId: string,
  now = new Date()
): RelationshipStateSnapshot {
  return {
    companionId,
    familiarityScore: 20,
    closenessScore: 18,
    recentEmotion: "刚刚开始建立关系",
    importantEvents: [
      {
        id: "event-first-chat",
        title: "第一次建立回响",
        date: now.toISOString(),
        source: "system",
        explanation: "创建关系对象时自动记录，作为长期关系时间线起点。"
      }
    ],
    lastInteractionAt: now.toISOString(),
    explanation: "初始状态采用低到中等分值，等待真实互动逐步调整。"
  };
}

export function updateRelationshipState(
  current: RelationshipStateSnapshot,
  signal: RelationshipSignal
): RelationshipStateUpdate {
  const message = signal.userMessage.trim();
  const signalsUsed = collectSignalsUsed(signal);
  const familiarityDelta = clampDelta(message.length > 18 ? 3 : 1);
  const closenessDelta = clampDelta(scoreClosenessDelta(message));
  const recentEmotion = detectEmotion(message) ?? current.recentEmotion;
  const importantEventsAdded = extractImportantEvents(message, signal);

  const state: RelationshipStateSnapshot = {
    ...current,
    familiarityScore: clampScore(current.familiarityScore + familiarityDelta),
    closenessScore: clampScore(current.closenessScore + closenessDelta),
    recentEmotion,
    importantEvents: [...importantEventsAdded, ...current.importantEvents].slice(0, 12),
    lastInteractionAt: signal.createdAt ?? new Date().toISOString(),
    explanation: [
      `熟悉度 +${familiarityDelta}：用户提供了新的表达或事实线索。`,
      `亲密度 ${closenessDelta >= 0 ? "+" : ""}${closenessDelta}：依据本轮情绪开放程度小幅调整。`,
      recentEmotion ? `最近情绪更新为“${recentEmotion}”。` : undefined,
      importantEventsAdded.length ? "发现可能的重要事件，进入时间线草稿。" : undefined
    ]
      .filter(Boolean)
      .join(" ")
  };

  return {
    state,
    changes: {
      familiarityDelta,
      closenessDelta,
      recentEmotion,
      importantEventsAdded,
      explanation: state.explanation,
      signalsUsed
    }
  };
}

function collectSignalsUsed(signal: RelationshipSignal) {
  return [
    signal.sourceMessageId ? `sourceMessageId:${signal.sourceMessageId}` : undefined,
    signal.userMessage.trim() ? "userMessage" : undefined,
    signal.assistantMessage?.trim() ? "assistantMessage" : undefined,
    signal.createdAt ? `createdAt:${signal.createdAt}` : undefined
  ].filter((item): item is string => Boolean(item));
}

function scoreClosenessDelta(message: string): number {
  if (lowEmotionPatterns.some((pattern) => pattern.test(message))) return 3;
  if (positiveEmotionPatterns.some((pattern) => pattern.test(message))) return 2;
  if (message.length > 40) return 2;
  return 1;
}

function detectEmotion(message: string): string | undefined {
  if (/难过|想哭|低落|见不到/.test(message)) return "想念或低落";
  if (/焦虑|害怕|慌/.test(message)) return "焦虑不安";
  if (/累|失眠|撑不住/.test(message)) return "疲惫";
  if (/开心|高兴|期待/.test(message)) return "开心期待";
  if (/想你|想见|喜欢/.test(message)) return "亲近想念";
  return undefined;
}

function extractImportantEvents(
  message: string,
  signal: RelationshipSignal
): ImportantEvent[] {
  if (!eventPatterns.some((pattern) => pattern.test(message))) return [];

  return [
    {
      id: `event-${signal.sourceMessageId ?? Date.now()}`,
      title: message.length > 28 ? `${message.slice(0, 28)}...` : message,
      date: signal.createdAt,
      source: signal.sourceMessageId,
      explanation: "命中重要事件关键词，后续应由记忆确认流程决定是否长期保留。"
    }
  ];
}

function clampDelta(delta: number): number {
  return Math.max(-5, Math.min(5, delta));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
