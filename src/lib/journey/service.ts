import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import { getCourse } from "./courses";
import { advance as graphAdvance, resolveStep, rewindIndex, checkpointFor } from "./courses/graph";
import type { EvidenceKind } from "./courses/types";
import {
  initialJourney, journeySteps, normalizeJourney,
  type CourseResult, type JourneyAction, type JourneyInput, type JourneyResponse, type JourneyStateV2
} from "./types";

declare global { var renewalJourneyStore: Map<string, JourneyStateV2 | unknown> | undefined; }
export class JourneyError extends Error {
  constructor(public status: number, message: string, public current?: JourneyResponse) { super(message); }
}
const invalid = () => new JourneyError(400, "引导参数无效。");
const conflict = (journey: JourneyStateV2): JourneyError => new JourneyError(409, "引导进度已更新，请重试。", { userId: "", journey });
const store = () => globalThis.renewalJourneyStore ??= new Map<string, JourneyStateV2 | unknown>();
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const results: CourseResult[] = ["learned", "practiced", "reused", "deferred", "skipped"];

/** Registration only: missing rows on read mean legacy. */
export function markNewJourneyAccount(userId: string) {
  if (!store().has(userId)) store().set(userId, initialJourney("active"));
}
export function clearJourneyAccount(userId: string) { globalThis.renewalJourneyStore?.delete(userId); }

const allowedKeys = new Set([
  "action", "expectedRevision", "step", "kind", "companionId", "courseId", "runId", "stepId",
  "evidence", "resourceId", "context", "mode", "contentVersion", "result", "replay", "reuse"
]);
const actions: JourneyAction[] = [
  "start", "resume", "pause", "skip", "advance", "observe", "course-start", "course-confirm",
  "course-skip-step", "course-pause", "course-leave", "course-rewind", "dismiss-invite", "reset-main",
  "reuse-companion"
];
export const evidenceKinds: EvidenceKind[] = [
  "companion-created", "companion-updated", "message-sent", "assistant-replied", "dream-started",
  "dream-generated", "dream-feedback-recorded", "dream-applied", "group-created", "group-message-sent",
  "memory-confirmed", "settings-saved"
];

export function parseJourneyInput(value: unknown): JourneyInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const v = value as JourneyInput & Record<string, unknown>;
  if (!Number.isSafeInteger(v.expectedRevision) || v.expectedRevision < 0 || v.expectedRevision >= 2147483647) throw invalid();
  if (!actions.includes(v.action)) throw invalid();
  if (Object.keys(v).some(key => !allowedKeys.has(key))) throw invalid();
  if (v.step !== undefined && (!journeySteps.includes(v.step) || v.action !== "advance")) throw invalid();
  if (v.kind !== undefined && v.action !== "observe") throw invalid();
  if (v.kind !== undefined && !["companion-created", "message-sent", "dream-started"].includes(v.kind)) throw invalid();
  if (v.action === "observe" && (!v.kind || !v.companionId)) throw invalid();
  if (v.companionId !== undefined && (typeof v.companionId !== "string" || !v.companionId.trim() || v.companionId.length > 128)) throw invalid();
  const course = v.courseId === undefined ? undefined : getCourse(v.courseId);
  if (v.courseId !== undefined && !course) throw invalid();
  if (v.runId !== undefined && (typeof v.runId !== "string" || v.runId.length < 4 || v.runId.length > 80)) throw invalid();
  if (v.mode !== undefined && v.mode !== "first" && v.mode !== "review") throw invalid();
  if (v.contentVersion !== undefined && (!Number.isSafeInteger(v.contentVersion) || v.contentVersion < 1)) throw invalid();
  if (v.result !== undefined && !results.includes(v.result)) throw invalid();
  if (v.replay !== undefined && typeof v.replay !== "boolean") throw invalid();
  if (v.reuse !== undefined && typeof v.reuse !== "boolean") throw invalid();
  if (v.evidence !== undefined && (typeof v.evidence !== "string" || !evidenceKinds.includes(v.evidence as EvidenceKind))) throw invalid();
  if (v.resourceId !== undefined && (typeof v.resourceId !== "string" || !v.resourceId.trim() || v.resourceId.length > 128)) throw invalid();
  if (v.context !== undefined) {
    if (!v.context || typeof v.context !== "object" || Array.isArray(v.context)) throw invalid();
    if (Object.keys(v.context).some(key => key !== "companionId" && key !== "groupId")) throw invalid();
    if (v.context.companionId !== undefined && (typeof v.context.companionId !== "string" || !v.context.companionId || v.context.companionId.length > 128)) throw invalid();
    if (v.context.groupId !== undefined && (typeof v.context.groupId !== "string" || !v.context.groupId || v.context.groupId.length > 128)) throw invalid();
  }
  if (v.action === "course-start" && !course) throw invalid();
  if (v.action === "reuse-companion") {
    if (!v.resourceId) throw invalid();
  }
  if (v.action === "course-confirm" || v.action === "course-skip-step" || v.action === "course-rewind") {
    if (!v.courseId || !v.stepId || !resolveStep(course!, v.stepId)) throw invalid();
  }
  if (v.action === "dismiss-invite" && !v.courseId) throw invalid();
  return v;
}

/** Record one course result without ever downgrading an actual practice. */
function setResult(state: JourneyStateV2, courseId: string, result: CourseResult, checkpoint: string | null) {
  const course = getCourse(courseId);
  if (!course) return;
  const previous = state.courses[courseId];
  state.courses[courseId] = {
    contentVersion: course.contentVersion,
    checkpoint,
    milestones: previous?.milestones ?? [],
    result: previous?.result === "practiced" && result !== "practiced" ? "practiced" : result,
    ...(previous?.reused ? { reused: true } : {})
  };
}

/**
 * Pure transition: state in, state out. Throws JourneyError on illegal moves.
 * Any accepted change bumps `revision` exactly once.
 */
export function transition(state: JourneyStateV2, v: JourneyInput, now = new Date().toISOString()): JourneyStateV2 {
  if (state.revision !== v.expectedRevision) throw conflict(state);
  const next: JourneyStateV2 = structuredClone(state);
  next.revision = state.revision + 1;

  if (v.action === "start") {
    return { ...initialJourney("active"), revision: next.revision, courses: {}, dismissedInvites: next.dismissedInvites };
  }
  if (v.action === "reset-main") {
    const course = getCourse("main")!;
    return {
      ...next, status: "active", step: "awakening",
      activeCourse: {
        id: "main", contentVersion: course.contentVersion, runId: uuid(), stepId: course.steps[0].id,
        mode: "review", context: next.companionId ? { companionId: next.companionId } : {}, startedAt: now
      }
    };
  }
  if (v.action === "skip") return { ...next, status: "skipped", activeCourse: null };
  if (v.action === "resume" && state.status === "paused") return { ...next, status: "active" };
  if (v.action === "pause" && state.status === "active") return { ...next, status: "paused", activeCourse: null };

  if (v.action === "course-pause" || v.action === "course-leave") {
    const active = next.activeCourse;
    if (!active) throw invalid();
    setResult(next, active.id, v.action === "course-pause" ? "deferred" : v.result ?? "deferred", active.stepId);
    if (v.action === "course-leave") next.deferredCourses = [...new Set([...next.deferredCourses, active.id])];
    next.activeCourse = null;
    return next;
  }
  if (v.action === "course-rewind") {
    const active = next.activeCourse;
    if (!active || active.id !== v.courseId) throw invalid();
    const course = getCourse(active.id)!;
    if (rewindIndex(course, active.stepId, v.stepId!) < 0) throw invalid();
    next.activeCourse = { ...active, stepId: v.stepId! };
    return next;
  }
  if (v.action === "dismiss-invite") {
    const course = getCourse(v.courseId!)!;
    next.dismissedInvites = { ...next.dismissedInvites, [course.id]: course.contentVersion };
    return next;
  }
  if (v.action === "reuse-companion") {
    const active = next.activeCourse;
    const course = active ? getCourse(active.id) : null;
    const step = active && course ? resolveStep(course, active.stepId) : null;
    // Only a run that was about to create a person may be re-pointed at one that exists.
    if (!active || !course || !step || step.completion.type !== "evidence" || step.completion.kind !== "companion-created") throw invalid();
    if (!v.resourceId) throw invalid();
    next.companionId = v.resourceId;
    next.activeCourse = { ...active, context: { ...active.context, companionId: v.resourceId } };
    const progress = next.courses[course.id] ?? { contentVersion: course.contentVersion, checkpoint: null, milestones: [] };
    next.courses[course.id] = { ...progress, contentVersion: course.contentVersion, reused: true };
    return next;
  }
  if (v.action === "course-start") {
    const course = getCourse(v.courseId!)!;
    if (v.contentVersion !== undefined && v.contentVersion !== course.contentVersion) throw invalid();
    if (next.activeCourse) throw new JourneyError(409, "还有一段主线或支线正在进行中，请先结束它，或选择暂歇。", { userId: "", journey: state });
    if (course.id === "main" && next.activeCourse === null && v.mode === "review" && state.status === "legacy") {
      // Review of the main line is allowed from legacy too; the run itself starts fresh.
    }
    const previous = next.courses[course.id];
    // Only a real ending turns a later start into a review; "deferred" still resumes.
    const finished = previous?.result !== undefined && previous.result !== "deferred";
    const mode = v.mode ?? (finished ? "review" : "first");
    const checkpoint = mode === "first" ? checkpointFor(course, previous?.checkpoint ?? null) : null;
    next.activeCourse = {
      id: course.id, contentVersion: course.contentVersion, runId: uuid(),
      stepId: checkpoint ?? course.steps[0].id, mode,
      context: { ...(v.context ?? {}) }, startedAt: now
    };
    if (next.status === "legacy" || next.status === "skipped") next.status = "active";
    return next;
  }

  if (next.status !== "active" && !next.activeCourse) throw new JourneyError(409, "请先开始或继续引导。", { userId: "", journey: state });

  if (v.action === "advance") {
    const targets: Partial<Record<JourneyStateV2["step"], JourneyStateV2["step"]>> = { awakening: "arrival", arrival: "lanterns", lanterns: "creation", dream: "complete" };
    const target = targets[next.step];
    if (!target || (v.step !== undefined && v.step !== target)) throw invalid();
    return { ...next, step: target, status: target === "complete" ? "completed" : next.status };
  }

  if (v.action === "observe") {
    // Legacy v1 observation path; kept so an older client can still finish its story.
    if (v.kind === "companion-created" && (next.step === "creation" || next.step === "lanterns")) return { ...next, step: "conversation", companionId: v.companionId! };
    if (v.companionId !== next.companionId) throw invalid();
    if (v.kind === "message-sent" && next.step === "conversation") return { ...next, step: "dream" };
    if (v.kind === "dream-started" && next.step === "dream") return { ...next, step: "complete", status: "completed" };
    throw invalid();
  }

  if (v.action === "course-confirm" || v.action === "course-skip-step") {
    const active = next.activeCourse;
    if (!active || active.id !== v.courseId || active.stepId !== v.stepId) throw invalid();
    const course = getCourse(active.id)!;
    const step = resolveStep(course, active.stepId)!;
    const skip = v.action === "course-skip-step";
    if (!skip) {
      if (step.completion.type === "evidence") {
        if (v.evidence !== step.completion.kind) throw invalid();
      } else if (v.evidence !== undefined) throw invalid();
    }
    const outcome = graphAdvance(course, active.stepId, !skip);
    if (!outcome) throw invalid();
    const progress = next.courses[course.id] ?? { contentVersion: course.contentVersion, checkpoint: null, milestones: [] };
    const milestones = skip || progress.milestones.includes(step.id) ? progress.milestones : [...progress.milestones, step.id];
    next.courses[course.id] = {
      contentVersion: course.contentVersion,
      checkpoint: outcome.stepId,
      milestones,
      ...(progress.result ? { result: progress.result } : {}),
      ...(progress.reused ? { reused: true } : {})
    };
    if (course.id === "main") {
      // Project onto the chapter of the step we are about to show, not the one just done.
      const chapter = outcome.chapter ?? step.chapter;
      if (chapter) next.step = chapter;
      if (step.completion.type === "evidence" && step.completion.kind === "companion-created" && v.resourceId) next.companionId = v.resourceId;
      if (v.context?.companionId) next.companionId = v.context.companionId;
      if (outcome.finished) { next.step = "complete"; next.status = "completed"; }
    }
    if (outcome.finished) {
      const practiced = milestones.some(id => resolveStep(course, id)?.completion.type === "evidence");
      const reused = Boolean(next.courses[course.id].reused) || v.result === "reused";
      next.courses[course.id] = {
        ...next.courses[course.id],
        checkpoint: null,
        result: reused ? "reused" : practiced ? "practiced" : "learned"
      };
      next.activeCourse = null;
      next.deferredCourses = next.deferredCourses.filter(id => id !== course.id);
    } else {
      next.activeCourse = { ...active, stepId: outcome.stepId };
      next.deferredCourses = skip
        ? [...new Set([...next.deferredCourses, course.id])]
        : next.deferredCourses.filter(id => id !== course.id);
    }
    return next;
  }

  throw invalid();
}

/* ------------------------------ evidence ------------------------------ */

export type EvidenceRequest = {
  userId: string;
  kind: EvidenceKind;
  stepStartedAt: string;
  companionId?: string;
  groupId?: string;
};

const newerThan = (value: Date | string | null | undefined, startedAt: string) => {
  if (!value) return false;
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  const start = Date.parse(startedAt);
  return Number.isFinite(time) && Number.isFinite(start) && time > start;
};

const ownedCompanion = (tx: Prisma.TransactionClient, userId: string, companionId: string) =>
  tx.companion.findFirst({ where: { id: companionId, userId }, select: { id: true, updatedAt: true } });

/** Server-side check that the business action really happened inside this run. */
export async function checkEvidence(tx: Prisma.TransactionClient, request: EvidenceRequest): Promise<boolean> {
  const { userId, kind, stepStartedAt, companionId, groupId } = request;
  if (kind === "settings-saved") {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { updatedAt: true } });
    return Boolean(user && newerThan(user.updatedAt, stepStartedAt));
  }
  if (kind === "group-created" || kind === "group-message-sent") {
    const rows = await tx.groupWorkspace.findMany({ where: { userId, ...(groupId ? { id: groupId } : {}) } });
    if (kind === "group-created") return rows.some(row => newerThan(row.createdAt, stepStartedAt));
    return rows.some(row => {
      const state = row.state as unknown as { messages?: Array<{ speakerId: string | null; createdAt: string }> };
      return (state.messages ?? []).some(message => message.speakerId === null && newerThan(message.createdAt, stepStartedAt));
    });
  }
  if (!companionId) return false;
  const companion = await ownedCompanion(tx, userId, companionId);
  if (!companion) throw new JourneyError(404, "角色不存在。");
  if (kind === "companion-created" || kind === "companion-updated") return newerThan(companion.updatedAt, stepStartedAt);
  if (kind === "message-sent" || kind === "assistant-replied") {
    const found = await tx.message.findFirst({
      where: {
        role: kind === "message-sent" ? "USER" : "ASSISTANT",
        createdAt: { gt: new Date(stepStartedAt) },
        conversation: { userId, companionId }
      },
      select: { id: true }
    });
    return Boolean(found);
  }
  if (kind === "dream-started" || kind === "dream-generated" || kind === "dream-feedback-recorded" || kind === "dream-applied") {
    const dream = await tx.dreamWorkspace.findFirst({ where: { userId, companionId } });
    if (!dream) return false;
    const state = dream.state as unknown as {
      status?: string;
      rounds?: Array<{ createdAt?: string; feedback?: unknown }>;
    };
    if (kind === "dream-started") return true;
    const rounds = state.rounds ?? [];
    if (kind === "dream-generated") return rounds.some(round => newerThan(round.createdAt, stepStartedAt));
    if (kind === "dream-feedback-recorded") return rounds.some(round => Boolean(round.feedback) && newerThan(round.createdAt, stepStartedAt));
    return state.status === "applied" && newerThan(dream.updatedAt, stepStartedAt);
  }
  if (kind === "memory-confirmed") {
    const found = await tx.memory.findFirst({
      where: { userId, companionId, status: { in: ["ACTIVE", "ARCHIVED"] }, updatedAt: { gt: new Date(stepStartedAt) } },
      select: { id: true }
    });
    return Boolean(found);
  }
  return false;
}

/** Same rules against the memory fallback stores. Read-only; never seeds resources. */
export function checkMemoryEvidence(request: EvidenceRequest): boolean {
  const { userId, kind, stepStartedAt, companionId } = request;
  if (kind === "settings-saved") return true;
  if (kind === "group-created" || kind === "group-message-sent") {
    const groups = globalThis.renewalGroupStore;
    if (!groups) return false;
    const mine = [...groups.values()].filter(group => group.userId === userId && (!request.groupId || group.id === request.groupId));
    if (kind === "group-created") return mine.some(group => newerThan(group.createdAt, stepStartedAt));
    return mine.some(group => group.messages.some(message => message.speakerId === null && newerThan(message.createdAt, stepStartedAt)));
  }
  if (!companionId) return false;
  const resources = globalThis.renewalStore;
  const companion = resources?.companions.find(item => item.id === companionId && item.userId === userId);
  if (!companion) throw new JourneyError(404, "角色不存在。");
  if (kind === "companion-created" || kind === "companion-updated") return newerThan(companion.updatedAt, stepStartedAt);
  if (kind === "message-sent" || kind === "assistant-replied") {
    const threads = new Set((resources?.conversations ?? []).filter(item => item.userId === userId && item.companionId === companionId).map(item => item.id));
    return (resources?.messages ?? []).some(item => item.role === (kind === "message-sent" ? "user" : "assistant") && threads.has(item.conversationId) && newerThan(item.createdAt, stepStartedAt));
  }
  if (kind === "dream-started" || kind === "dream-generated" || kind === "dream-feedback-recorded" || kind === "dream-applied") {
    const dream = globalThis.renewalDreamStore?.get(companionId);
    if (!dream || dream.userId !== userId) return false;
    const state = dream.state as { status?: string; rounds?: Array<{ createdAt?: string; feedback?: unknown }> };
    if (kind === "dream-started") return true;
    const rounds = state.rounds ?? [];
    if (kind === "dream-generated") return rounds.some(round => newerThan(round.createdAt, stepStartedAt));
    if (kind === "dream-feedback-recorded") return rounds.some(round => Boolean(round.feedback) && newerThan(round.createdAt, stepStartedAt));
    return state.status === "applied" && newerThan((dream.state as { updatedAt?: string }).updatedAt, stepStartedAt);
  }
  if (kind === "memory-confirmed") {
    return (resources?.memories ?? []).some(item => item.userId === userId && item.companionId === companionId && item.status === "active" && newerThan(item.updatedAt, stepStartedAt));
  }
  return false;
}

/** Which companion/group the active run is bound to, for evidence scoping. */
function scopeOf(state: JourneyStateV2, v: JourneyInput) {
  return {
    // Explicit resource wins, then the run context, then the main line's bound person.
    companionId: v.resourceId ?? v.context?.companionId ?? state.activeCourse?.context.companionId ?? state.companionId ?? undefined,
    groupId: v.context?.groupId ?? state.activeCourse?.context.groupId
  };
}

/* ------------------------------ service ------------------------------ */

function readStored(row: unknown): { journey: JourneyStateV2; upgraded: boolean } {
  return normalizeJourney(row);
}

export class JourneyService {
  /** Read-only: never creates rows, never persists an upgrade. */
  async get(userId: string): Promise<JourneyResponse> {
    const row = shouldUseMemoryFallback()
      ? globalThis.renewalJourneyStore?.get(userId)
      : (await prisma.userJourney.findUnique({ where: { userId } }))?.state;
    const { journey } = readStored(row);
    return { userId, journey: structuredClone(journey) };
  }

  async post(userId: string, value: unknown): Promise<JourneyResponse> {
    const v = parseJourneyInput(value);
    if (shouldUseMemoryFallback()) return this.postMemory(userId, v);
    return this.postPrisma(userId, v);
  }

  private async postMemory(userId: string, v: JourneyInput): Promise<JourneyResponse> {
    const { journey: current } = readStored(store().get(userId));
    let next: JourneyStateV2;
    try {
      next = transition(current, v);
    } catch (error) {
      // Never leak an empty account back to the client; the 409 body must carry it.
      if (error instanceof JourneyError && error.status === 409) {
        throw new JourneyError(409, error.message, { userId, journey: structuredClone(error.current?.journey ?? current) });
      }
      throw error;
    }
    // Evidence is verified before the write, against reads only.
    if (v.action === "course-confirm" && v.evidence) {
      const step = resolveStep(getCourse(v.courseId!)!, v.stepId!);
      if (step?.completion.type === "evidence") {
        const scope = scopeOf(current, v);
        const ok = checkMemoryEvidence({ userId, kind: step.completion.kind, stepStartedAt: current.activeCourse!.startedAt, ...scope });
        if (!ok) throw new JourneyError(409, "这一步还没有出现可确认的结果，请先完成操作。", { userId, journey: structuredClone(current) });
      }
    }
    if (v.action === "observe") memoryObserveEvidence(userId, v);
    store().set(userId, next);
    return { userId, journey: structuredClone(next) };
  }

  private async postPrisma(userId: string, v: JourneyInput): Promise<JourneyResponse> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await prisma.$transaction(async tx => {
          const row = await tx.userJourney.findUnique({ where: { userId } });
          const { journey: current } = readStored(row?.state);
          const next = transition(current, v);
          if (v.action === "course-confirm" && v.evidence) {
            const step = resolveStep(getCourse(v.courseId!)!, v.stepId!);
            if (step?.completion.type === "evidence") {
              const scope = scopeOf(current, v);
              const ok = await checkEvidence(tx, { userId, kind: step.completion.kind, stepStartedAt: current.activeCourse!.startedAt, ...scope });
              if (!ok) throw new JourneyError(409, "这一步还没有出现可确认的结果，请先完成操作。", { userId, journey: structuredClone(current) });
            }
          }
          if (v.action === "observe") await observeEvidence(tx, userId, v);
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
        if ((error instanceof JourneyError && error.status === 409) || code === "P2034" || code === "P2002") {
          throw new JourneyError(409, "引导进度已更新，请重试。", await this.get(userId));
        }
        throw error;
      }
    }
  }
}

/** Legacy v1 observe path: works only while the old chapter progression is still in use. */
async function observeEvidence(tx: Prisma.TransactionClient, userId: string, v: JourneyInput) {
  const owned = await tx.companion.findFirst({ where: { id: v.companionId, userId }, select: { id: true } });
  if (!owned) throw new JourneyError(404, "角色不存在。");
  if (v.kind === "message-sent" && !await tx.message.findFirst({ where: { role: "USER", conversation: { userId, companionId: v.companionId } }, select: { id: true } })) throw invalid();
  if (v.kind === "dream-started" && !await tx.dreamWorkspace.findFirst({ where: { userId, companionId: v.companionId }, select: { id: true } })) throw invalid();
}

function memoryObserveEvidence(userId: string, v: JourneyInput) {
  const resources = globalThis.renewalStore;
  if (!resources?.companions.some(c => c.id === v.companionId && c.userId === userId)) throw new JourneyError(404, "角色不存在。");
  if (v.kind === "message-sent") {
    const threads = new Set(resources.conversations.filter(c => c.userId === userId && c.companionId === v.companionId).map(c => c.id));
    if (!resources.messages.some(m => m.role === "user" && threads.has(m.conversationId))) throw invalid();
  }
  if (v.kind === "dream-started" && globalThis.renewalDreamStore?.get(v.companionId!)?.userId !== userId) throw invalid();
}
