import type {
  ImportantEvent,
  RelationshipSignal,
  RelationshipStateSnapshot,
  RelationshipStateUpdate
} from "./types";

const positiveEmotionPatterns = [/开心|高兴|期待|安心|喜欢|想你|想见|谢谢/];
const lowEmotionPatterns = [/难过|崩溃|累|失眠|害怕|孤独|想哭|见不到|低落|焦虑/];
const eventPatterns = [/生日|纪念日|约定|第一次|见面|离开|去世|分开|考试|面试|搬家/];
const sensitiveSignalPatterns: Array<[RegExp, string]> = [
  [/\bapi[_-]?key\s*=\s*[^,\s，。；;]+/gi, ""],
  [/\b(?:base[_-]?url|endpoint(?:[_-]?url)?)\s*[:=]?\s*https?:\/\/[^\s，。；;]+/gi, ""],
  [/\bprompt\s*=\s*[^,\s，。；;]+/gi, ""],
  [/https?:\/\/[^\s，。；;]+/gi, ""],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, ""]
];

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
  const message = sanitizeSignalText(signal.userMessage);
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
      importantEventsAdded.length
        ? `发现可能的重要事件：${importantEventsAdded
            .map((event) => event.title)
            .join("；")}。`
        : undefined,
      buildSignalExplanation(message)
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

function sanitizeSignalText(message: string): string {
  return sensitiveSignalPatterns
    .reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), message)
    .replace(/\s+/g, " ")
    .trim();
}

function scoreClosenessDelta(message: string): number {
  if (lowEmotionPatterns.some((pattern) => pattern.test(message))) return 3;
  if (positiveEmotionPatterns.some((pattern) => pattern.test(message))) return 2;
  if (message.length > 40) return 2;
  return 1;
}

function detectEmotion(message: string): string | undefined {
  const emotions = [
    /害怕|慌/.test(message) ? "害怕" : undefined,
    /想你|想见|见不到|很想|想有人在/.test(message) ? "想念" : undefined,
    /难过|想哭|低落|孤独|被丢下/.test(message) ? "低落" : undefined,
    /焦虑/.test(message) ? "焦虑" : undefined,
    /累|失眠|撑不住|崩溃/.test(message) ? "疲惫" : undefined,
    /开心|高兴/.test(message) ? "开心" : undefined,
    /期待/.test(message) ? "期待" : undefined,
    /喜欢|安心|谢谢/.test(message) ? "亲近" : undefined
  ].filter((item): item is string => Boolean(item));

  return [...new Set(emotions)].slice(0, 3).join("、") || undefined;
}

function extractImportantEvents(
  message: string,
  signal: RelationshipSignal
): ImportantEvent[] {
  if (!eventPatterns.some((pattern) => pattern.test(message))) return [];

  return [
    {
      id: `event-${signal.sourceMessageId ?? Date.now()}`,
      title: summarizeImportantEvent(message),
      date: signal.createdAt,
      source: signal.sourceMessageId,
      explanation: `命中重要事件关键词：${summarizeImportantEvent(
        message
      )}，后续应由记忆确认流程决定是否长期保留。`
    }
  ];
}

function summarizeImportantEvent(message: string): string {
  const labels = [
    /第一次聊天|第一次认真|第一次/.test(message) ? "第一次聊天" : undefined,
    /生日那天|生日/.test(message) ? "生日那天" : undefined,
    /纪念日/.test(message) ? "纪念日" : undefined,
    /约定/.test(message) ? "约定" : undefined,
    /见面/.test(message) ? "见面" : undefined,
    /离开|去世|分开/.test(message) ? "分离相关事件" : undefined,
    /考试/.test(message) ? "考试" : undefined,
    /面试/.test(message) ? "面试" : undefined,
    /搬家/.test(message) ? "搬家" : undefined
  ].filter((item): item is string => Boolean(item));

  return [...new Set(labels)].join("；") || (message.length > 28 ? `${message.slice(0, 28)}...` : message);
}

function buildSignalExplanation(message: string): string | undefined {
  const fragments = [
    /害怕[^，。！？\s]*(?:被)?[^，。！？\s]*丢下/.test(message) ? "害怕被丢下" : undefined,
    /生日那天|生日/.test(message) ? "生日那天" : undefined,
    /第一次聊天|第一次认真|第一次/.test(message) ? "第一次聊天" : undefined,
    /想你|很想你|想有人在|想见/.test(message) ? "想你" : undefined
  ].filter((item): item is string => Boolean(item));

  if (!fragments.length) return undefined;

  return `具体信号：${[...new Set(fragments)].join("、")}。`;
}

function clampDelta(delta: number): number {
  return Math.max(-5, Math.min(5, delta));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
