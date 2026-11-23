import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import { initialJourney, journeySteps, type JourneyInput, type JourneyResponse, type JourneyState } from "./types";

declare global { var renewalJourneyStore: Map<string, JourneyState> | undefined; }
export class JourneyError extends Error {
  constructor(public status: number, message: string, public current?: JourneyResponse) { super(message); }
}
const invalid = () => new JourneyError(400, "引导参数无效。");
const store = () => globalThis.renewalJourneyStore ??= new Map<string, JourneyState>();
/** Registration only: missing rows on read mean legacy. */
export function markNewJourneyAccount(userId: string) {
  if (!store().has(userId)) store().set(userId, initialJourney("active"));
}
export function clearJourneyAccount(userId: string) { globalThis.renewalJourneyStore?.delete(userId); }
function input(value: unknown): JourneyInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const v = value as JourneyInput;
  if (!Number.isSafeInteger(v.expectedRevision) || v.expectedRevision < 0 || v.expectedRevision >= 2147483647 ||
      !["start", "resume", "pause", "skip", "advance", "observe"].includes(v.action) ||
      Object.keys(v).some(k => !["action", "expectedRevision", "step", "kind", "companionId"].includes(k)) ||
      (v.step !== undefined && (!journeySteps.includes(v.step) || v.action !== "advance")) ||
      (v.companionId !== undefined && (typeof v.companionId !== "string" || !v.companionId.trim() || v.companionId.length > 128 || v.action !== "observe")) ||
      (v.kind !== undefined && (!["companion-created", "message-sent", "dream-started"].includes(v.kind) || v.action !== "observe")) ||
      (v.action === "observe" && (!v.kind || !v.companionId))) throw invalid();
  return v;
}
function transition(userId: string, state: JourneyState, v: JourneyInput): JourneyState {
  if (state.revision !== v.expectedRevision) throw new JourneyError(409, "引导进度已更新，请重试。", { userId, journey: structuredClone(state) });
  const next = { ...state, revision: state.revision + 1 };
  if (v.action === "start") return { ...initialJourney("active"), revision: next.revision };
  if (v.action === "skip") return { ...next, status: "skipped" };
  if (v.action === "resume" && state.status === "paused") return { ...next, status: "active" };
  if (v.action === "pause" && state.status === "active") return { ...next, status: "paused" };
  if (state.status !== "active") throw new JourneyError(409, "请先开始或继续引导。", { userId, journey: state });
  if (v.action === "advance") {
    const targets: Partial<Record<JourneyState["step"], JourneyState["step"]>> = { awakening: "arrival", arrival: "lanterns", lanterns: "creation", dream: "complete" };
    const target = targets[state.step];
    if (!target || (v.step !== undefined && v.step !== target)) throw invalid();
    return { ...next, step: target, status: target === "complete" ? "completed" : "active" };
  }
  if (v.action === "observe") {
    if (v.kind === "companion-created" && (state.step === "creation" || state.step === "lanterns")) return { ...next, step: "conversation", companionId: v.companionId! };
    if (v.companionId !== state.companionId) throw invalid();
    if (v.kind === "message-sent" && state.step === "conversation") return { ...next, step: "dream" };
    if (v.kind === "dream-started" && state.step === "dream") return { ...next, step: "complete", status: "completed" };
  }
  throw invalid();
}
async function evidence(userId: string, v: JourneyInput, tx: Prisma.TransactionClient) {
  if (v.action !== "observe") return;
  const owned = await tx.companion.findFirst({ where: { id: v.companionId, userId }, select: { id: true } });
  if (!owned) throw new JourneyError(404, "角色不存在。");
  if (v.kind === "message-sent" && !await tx.message.findFirst({ where: { role: "USER", conversation: { userId, companionId: v.companionId } }, select: { id: true } })) throw invalid();
  if (v.kind === "dream-started" && !await tx.dreamWorkspace.findFirst({ where: { userId, companionId: v.companionId }, select: { id: true } })) throw invalid();
}
function memoryEvidence(userId: string, v: JourneyInput) {
  if (v.action !== "observe") return;
  // Read only, without seeding demo resources; validation and CAS share one JS turn.
  const resources = globalThis.renewalStore;
  if (!resources?.companions.some(c => c.id === v.companionId && c.userId === userId)) throw new JourneyError(404, "角色不存在。");
  if (v.kind === "message-sent") {
    const threads = new Set(resources.conversations.filter(c => c.userId === userId && c.companionId === v.companionId).map(c => c.id));
    if (!resources.messages.some(m => m.role === "user" && threads.has(m.conversationId))) throw invalid();
  }
  if (v.kind === "dream-started" && globalThis.renewalDreamStore?.get(v.companionId!)?.userId !== userId) throw invalid();
}
export class JourneyService {
  async get(userId: string): Promise<JourneyResponse> {
    const row = shouldUseMemoryFallback() ? globalThis.renewalJourneyStore?.get(userId) : (await prisma.userJourney.findUnique({ where: { userId } }))?.state as unknown as JourneyState | undefined;
    return { userId, journey: structuredClone(row ?? initialJourney()) };
  }
  async post(userId: string, value: unknown): Promise<JourneyResponse> {
    const v = input(value);
    if (shouldUseMemoryFallback()) {
      const next = transition(userId, store().get(userId) ?? initialJourney(), v);
      memoryEvidence(userId, v);
      store().set(userId, next);
      return { userId, journey: structuredClone(next) };
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await prisma.$transaction(async tx => {
          const row = await tx.userJourney.findUnique({ where: { userId } });
          const next = transition(userId, row ? row.state as unknown as JourneyState : initialJourney(), v);
          await evidence(userId, v, tx);
          const data = { revision: next.revision, state: next as unknown as Prisma.InputJsonValue };
          if (row) {
            const changed = await tx.userJourney.updateMany({ where: { userId, revision: v.expectedRevision }, data });
            if (changed.count !== 1) throw new JourneyError(409, "引导进度已更新，请重试。");
          } else await tx.userJourney.create({ data: { userId, ...data } });
          return { userId, journey: next };
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if ((code === "P2034" || code === "P2002") && attempt < 2) continue;
        if ((error instanceof JourneyError && error.status === 409) || code === "P2034" || code === "P2002") throw new JourneyError(409, "引导进度已更新，请重试。", await this.get(userId));
        throw error;
      }
    }
  }
}
