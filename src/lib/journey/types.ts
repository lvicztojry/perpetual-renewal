export const journeySteps = ["awakening", "arrival", "lanterns", "creation", "conversation", "dream", "complete"] as const;
export type JourneyStep = typeof journeySteps[number];
export type JourneyStatus = "legacy" | "active" | "paused" | "completed" | "skipped";
/** Result of one course. Never reuse `learned` to claim a business action ran. */
export type CourseResult = "learned" | "practiced" | "reused" | "deferred" | "skipped";

export type ActiveCourse = {
  id: string;
  contentVersion: number;
  runId: string;
  stepId: string;
  mode: "first" | "review";
  context: { companionId?: string; groupId?: string };
  /** Server timestamp of this run. Evidence must be newer than it. */
  startedAt: string;
};

export type CourseProgress = {
  contentVersion: number;
  checkpoint: string | null;
  result?: CourseResult;
  milestones: string[];
  /** This run continued with the user's existing companion instead of creating one. */
  reused?: boolean;
};

export type JourneyStateV2 = {
  version: 2;
  step: JourneyStep;
  status: JourneyStatus;
  companionId: string | null;
  revision: number;
  activeCourse: ActiveCourse | null;
  courses: Record<string, CourseProgress>;
  deferredCourses: string[];
  /** course ID -> content version the user declined. */
  dismissedInvites: Record<string, number>;
};

/** Older single-version state, still readable from persisted rows and snapshots. */
export type JourneyStateV1 = { version: 1; step: JourneyStep; status: JourneyStatus; companionId: string | null; revision: number };
export type JourneyState = JourneyStateV2;

export type JourneyResponse = { userId: string; journey: JourneyStateV2 };

export type JourneyAction =
  | "start"
  | "resume"
  | "pause"
  | "skip"
  | "advance"
  | "observe"
  | "course-start"
  | "course-confirm"
  | "course-skip-step"
  | "course-pause"
  | "course-leave"
  | "course-rewind"
  | "dismiss-invite"
  | "reset-main"
  | "reuse-companion";

export type JourneyInput = {
  action: JourneyAction;
  expectedRevision: number;
  step?: JourneyStep;
  kind?: "companion-created" | "message-sent" | "dream-started";
  companionId?: string;
  courseId?: string;
  runId?: string;
  stepId?: string;
  /** Evidence kind for `course-confirm: business` or an observe-compatible milestone. */
  evidence?: string;
  resourceId?: string;
  context?: { companionId?: string; groupId?: string };
  mode?: "first" | "review";
  contentVersion?: number;
  /** Result recorded when the user leaves/skips a course. */
  result?: CourseResult;
  /** Review-mode restart of the same course. */
  replay?: boolean;
  /** Continue this run with an existing companion instead of creating one. */
  reuse?: boolean;
};

export const initialJourney = (status: JourneyStatus = "legacy"): JourneyStateV2 => ({
  version: 2,
  step: "awakening",
  status,
  companionId: null,
  revision: 0,
  activeCourse: null,
  courses: {},
  deferredCourses: [],
  dismissedInvites: {}
});

/** Lift a stored v1 payload. Never mutates the stored value. */
export function normalizeJourney(value: unknown): { journey: JourneyStateV2; upgraded: boolean } {
  if (!isObject(value)) return { journey: initialJourney(), upgraded: false };
  const version = value.version;
  if (version === 2) {
    const state = readV2(value);
    return state ? { journey: state, upgraded: false } : { journey: initialJourney(), upgraded: false };
  }
  if (version === 1) {
    const v1 = readV1(value);
    if (!v1) return { journey: initialJourney(), upgraded: false };
    return { journey: liftV1(v1), upgraded: true };
  }
  return { journey: initialJourney(), upgraded: false };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readV1(value: Record<string, unknown>): JourneyStateV1 | null {
  if (!journeySteps.includes(value.step as JourneyStep)) return null;
  if (!["legacy", "active", "paused", "completed", "skipped"].includes(value.status as string)) return null;
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return null;
  if (!(value.companionId === null || typeof value.companionId === "string")) return null;
  return {
    version: 1,
    step: value.step as JourneyStep,
    status: value.status as JourneyStatus,
    companionId: value.companionId as string | null,
    revision: value.revision as number
  };
}

function readV2(value: Record<string, unknown>): JourneyStateV2 | null {
  const v1 = readV1(value);
  if (!v1) return null;
  const activeCourse = readActiveCourse(value.activeCourse);
  if (activeCourse === undefined) return null;
  const courses = readCourses(value.courses);
  if (!courses) return null;
  const deferred = readStringArray(value.deferredCourses);
  if (!deferred) return null;
  const dismissed = readDismissed(value.dismissedInvites);
  if (!dismissed) return null;
  return {
    version: 2, step: v1.step, status: v1.status, companionId: v1.companionId, revision: v1.revision,
    activeCourse, courses, deferredCourses: deferred, dismissedInvites: dismissed
  };
}

function readActiveCourse(value: unknown): ActiveCourse | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return undefined;
  if (typeof value.id !== "string" || typeof value.runId !== "string" || typeof value.stepId !== "string") return undefined;
  if (!Number.isSafeInteger(value.contentVersion) || (value.contentVersion as number) < 1) return undefined;
  if (value.mode !== "first" && value.mode !== "review") return undefined;
  if (typeof value.startedAt !== "string" || Number.isNaN(Date.parse(value.startedAt))) return undefined;
  const context = readContext(value.context);
  if (!context) return undefined;
  return {
    id: value.id, contentVersion: value.contentVersion as number, runId: value.runId,
    stepId: value.stepId, mode: value.mode, context, startedAt: value.startedAt
  };
}

function readContext(value: unknown): { companionId?: string; groupId?: string } | null {
  if (value === null || value === undefined) return {};
  if (!isObject(value)) return null;
  const out: { companionId?: string; groupId?: string } = {};
  if (value.companionId !== undefined) { if (typeof value.companionId !== "string" || !value.companionId) return null; out.companionId = value.companionId; }
  if (value.groupId !== undefined) { if (typeof value.groupId !== "string" || !value.groupId) return null; out.groupId = value.groupId; }
  return out;
}

function readCourses(value: unknown): Record<string, CourseProgress> | null {
  if (value === null || value === undefined) return {};
  if (!isObject(value)) return null;
  const out: Record<string, CourseProgress> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isObject(raw)) return null;
    if (!Number.isSafeInteger(raw.contentVersion) || (raw.contentVersion as number) < 1) return null;
    const checkpoint = raw.checkpoint === null || raw.checkpoint === undefined ? null : raw.checkpoint;
    if (checkpoint !== null && typeof checkpoint !== "string") return null;
    let result: CourseResult | undefined;
    if (raw.result !== undefined) {
      if (!["learned", "practiced", "reused", "deferred", "skipped"].includes(raw.result as string)) return null;
      result = raw.result as CourseResult;
    }
    const milestones = readStringArray(raw.milestones);
    if (!milestones) return null;
    if (raw.reused !== undefined && typeof raw.reused !== "boolean") return null;
    out[id] = {
      contentVersion: raw.contentVersion as number,
      checkpoint,
      milestones,
      ...(result ? { result } : {}),
      ...(raw.reused === true ? { reused: true } : {})
    };
  }
  return out;
}

function readStringArray(value: unknown): string[] | null {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) return null;
  return value as string[];
}

function readDismissed(value: unknown): Record<string, number> | null {
  if (value === null || value === undefined) return {};
  if (!isObject(value)) return null;
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!Number.isSafeInteger(raw) || (raw as number) < 1) return null;
    out[id] = raw as number;
  }
  return out;
}

/**
 * Legacy progress maps onto the nearest explainable step of the same chapter.
 * Practical chapters keep their checkpoint but are never treated as completed.
 */
function liftV1(v1: JourneyStateV1): JourneyStateV2 {
  return { ...initialJourney(v1.status), step: v1.step, companionId: v1.companionId, revision: v1.revision };
}
