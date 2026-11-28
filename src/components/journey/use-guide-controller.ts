"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CourseDefinition, CourseStep } from "@/lib/journey/courses/types";
import type { CourseProgress, JourneyResponse, JourneyStateV2 } from "@/lib/journey/types";
import { JOURNEY_EVIDENCE_EVENT, type JourneyEvidence } from "@/lib/journey/events";
import { getCourse } from "@/lib/journey/courses";

const SUPPRESS_KEY = "renewal:journey-suppress:v2";
const LEGACY_SUPPRESS_KEY = "renewal:journey-suppress:v1";

function suppressed(userId: string | undefined) {
  if (typeof window === "undefined") return false;
  const key = `${SUPPRESS_KEY}:${userId ?? "session"}`;
  try {
    if (sessionStorage.getItem(key) === "1") return true;
    // A test or old client may only have set the v1 flag.
    return sessionStorage.getItem(LEGACY_SUPPRESS_KEY) === "1";
  } catch { return false; }
}
function rememberSuppression(userId: string | undefined, value: boolean) {
  const key = `${SUPPRESS_KEY}:${userId ?? "session"}`;
  try {
    if (value) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch { /* Private mode keeps the in-memory flag. */ }
}

/** A course with a saved step is resumable unless it was finished or explicitly skipped. */
function hasCheckpoint(journey: JourneyStateV2) {
  if (journey.status !== "active") return false;
  return Object.values(journey.courses).some(progress =>
    progress.checkpoint && (progress.result === undefined || progress.result === "deferred")
  );
}

export type GuidePhase = "hidden" | "stepping" | "paused" | "invite" | "unavailable";

export type GuideController = {
  phase: GuidePhase;
  journey: JourneyStateV2 | null;
  course: CourseDefinition | null;
  step: CourseStep | null;
  stepNumber: number;
  stepTotal: number;
  progress: CourseProgress | undefined;
  /** The branch offered for the page the user is on, when it has never been walked. */
  invite: CourseDefinition | null;
  /** A step whose context is missing cannot point anywhere; it offers a way back instead. */
  unmetRequirement: "companion" | "group" | null;
  busy: boolean;
  error: string;
  notice: string;
  dismissed: boolean;
  directoryOpen: boolean;
  start: (courseId: string, options?: { mode?: "first" | "review"; context?: { companionId?: string; groupId?: string } }) => Promise<boolean>;
  confirm: () => Promise<boolean>;
  skipStep: () => Promise<boolean>;
  back: () => Promise<boolean>;
  pause: () => Promise<boolean>;
  skipCourse: (result?: "skipped" | "deferred") => Promise<boolean>;
  reuseCompanion: (companionId: string) => Promise<boolean>;
  acceptInvite: () => Promise<boolean>;
  declineInvite: () => Promise<boolean>;
  dismiss: () => void;
  openDirectory: () => void;
  closeDirectory: () => void;
  reload: () => Promise<JourneyResponse | null>;
  resetMain: () => Promise<boolean>;
};

/**
 * Owns reading and writing journey progress for one account. Every POST carries the
 * revision it saw; an evidence step advances only after the matching business notice.
 */
export function useGuideController({ userId, pageBranch, hasCompanion, hasGroup }: {
  userId?: string;
  /** Branch that fits the current page, offered once when it has never been walked. */
  pageBranch?: string;
  hasCompanion?: boolean;
  hasGroup?: boolean;
}): GuideController {
  const live = useRef(true);
  const record = useRef<JourneyResponse | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const requests = useRef(new Set<AbortController>());
  const readAbort = useRef<AbortController | null>(null);
  const evidence = useRef(new Map<string, JourneyEvidence>());
  const [journey, setJourney] = useState<JourneyStateV2 | null>(null);
  const [phase, setPhase] = useState<GuidePhase>("hidden");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dismissed, setDismissed] = useState(() => suppressed(userId));
  const [directoryOpen, setDirectoryOpen] = useState(false);

  const accept = useCallback((next: JourneyResponse) => {
    if (!live.current) return false;
    if (userId && next.userId !== userId) return false;
    if (record.current && record.current.userId !== next.userId) {
      evidence.current.clear();
      setError("");
      setNotice("");
    }
    record.current = next;
    setJourney(next.journey);
    return true;
  }, [userId]);

  const load = useCallback(async (): Promise<JourneyResponse | null> => {
    readAbort.current?.abort();
    const controller = new AbortController();
    readAbort.current = controller;
    try {
      const response = await fetch("/api/me/journey", { cache: "no-store", signal: controller.signal });
      if (!live.current || controller.signal.aborted) return null;
      if (response.status === 401) {
        record.current = null;
        setJourney(null);
        setPhase("hidden");
        return null;
      }
      if (!response.ok) throw new Error("unavailable");
      const next = await response.json() as JourneyResponse;
      if (!next?.journey || next.journey.version !== 2 || !Array.isArray(next.journey.deferredCourses)) throw new Error("invalid response");
      if (!accept(next)) return null;
      // A reload with a running course picks the card back up unless it was dismissed;
      // A deferred run offers the way back through the small "继续" strip.
      if (next.journey.activeCourse && !suppressed(userId)) setPhase(current => current === "hidden" ? "stepping" : current);
      else if (!next.journey.activeCourse && hasCheckpoint(next.journey)) setPhase(current => current === "hidden" ? "paused" : current);
      else if (!next.journey.activeCourse) setPhase(current => current === "paused" ? "hidden" : current);
      return next;
    } catch {
      if (live.current && !controller.signal.aborted) {
        setError("风声有些远，暂时没能接上。请再试一次。");
        setPhase("unavailable");
      }
      return null;
    }
  }, [accept, userId]);

  const act = useCallback((body: (current: JourneyResponse) => Record<string, unknown> | null): Promise<JourneyResponse | null> => {
    async function run(retried = false): Promise<JourneyResponse | null> {
      const previous = record.current ?? await load();
      if (!previous || !live.current) return null;
      const payload = body(previous);
      if (!payload) return null;
      setBusy(true);
      setError("");
      const controller = new AbortController();
      requests.current.add(controller);
      try {
        const response = await fetch("/api/me/journey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ ...payload, expectedRevision: previous.journey.revision })
        });
        if (!live.current || controller.signal.aborted) return null;
        if (response.status === 401) {
          record.current = null;
          setJourney(null);
          setPhase("hidden");
          return null;
        }
        if (response.status === 409) {
          const refreshed = await load();
          const retryable = payload.action === "course-confirm" || payload.action === "course-skip-step";
          if (retryable && !retried && refreshed?.userId === previous.userId && live.current) return run(true);
          setError("灯下的进度已有新的一页。已为你重新接上，请再确认一次。");
          return null;
        }
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(typeof body.error === "string" ? body.error : "unavailable");
        }
        const next = await response.json() as JourneyResponse;
        if (!live.current || controller.signal.aborted) return null;
        if (next.userId !== previous.userId) { await load(); return null; }
        if (!accept(next)) return null;
        setNotice("");
        return next;
      } catch (failure) {
        if (live.current && !controller.signal.aborted) {
          setError(failure instanceof Error && failure.message && failure.message !== "unavailable" ? failure.message : "这一页还没能保存。可以再试一次。");
        }
        return null;
      } finally {
        requests.current.delete(controller);
        if (live.current) setBusy(false);
      }
    }
    const task = chain.current.then(() => run(), () => run());
    chain.current = task;
    return task;
  }, [accept, load]);

  useEffect(() => {
    live.current = true;
    const running = requests.current;
    return () => {
      live.current = false;
      readAbort.current?.abort();
      running.forEach(controller => controller.abort());
    };
  }, []);

  // Same deferred-start idiom as the other workspaces: the first read never
  // synchronously re-renders the component that mounted it.
  useEffect(() => { void Promise.resolve().then(() => { if (live.current) return load(); }); }, [load, userId]);

  // Another tab (or the native shell returning from background) may have moved the
  // progress; re-read without ever inferring a step from a route.
  useEffect(() => {
    let pending = false;
    const refresh = () => {
      if (pending || busy) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest("dialog[open], [role=\"dialog\"]")) return;
      pending = true;
      void load().finally(() => { pending = false; });
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load, busy]);

  const currentCourse = journey?.activeCourse ? getCourse(journey.activeCourse.id) ?? null : null;
  const currentStep = currentCourse && journey?.activeCourse
    ? currentCourse.steps.find(step => step.id === journey.activeCourse!.stepId) ?? null
    : null;
  const stepNumber = currentCourse && currentStep ? currentCourse.steps.findIndex(step => step.id === currentStep.id) + 1 : 0;
  const stepTotal = currentCourse?.steps.length ?? 0;
  const progress = journey?.activeCourse ? journey.courses[journey.activeCourse.id] : undefined;

  // One invitation per branch and content version; declining is remembered per account.
  // Only once progress is known: during the first read we must not guess.
  const inviteCourse = journey && !journey.activeCourse && pageBranch ? getCourse(pageBranch) ?? null : null;
  const invite = inviteCourse && !journey?.courses[inviteCourse.id]?.result
    && (journey?.dismissedInvites[inviteCourse.id] ?? 0) < inviteCourse.contentVersion
    ? inviteCourse : null;
  const unmetRequirement = currentStep?.requires === "companion" && hasCompanion === false ? "companion"
    : currentStep?.requires === "group" && hasGroup === false ? "group" : null;

  const start = useCallback(async (courseId: string, options?: { mode?: "first" | "review"; context?: { companionId?: string; groupId?: string } }) => {
    const course = getCourse(courseId);
    if (!course) return false;
    if (record.current?.journey.activeCourse) {
      // Switching courses leaves the current one deferred, then starts the new run.
      await act(current => current.journey.activeCourse ? { action: "course-leave", result: "deferred" } : null);
    }
    const next = await act(() => ({
      action: "course-start", courseId, contentVersion: course.contentVersion,
      mode: options?.mode, context: options?.context
    }));
    if (!next) return false;
    evidence.current.clear();
    setDismissed(false);
    rememberSuppression(userId, false);
    setPhase("stepping");
    setDirectoryOpen(false);
    return true;
  }, [act, userId]);

  const confirm = useCallback(async () => {
    const current = record.current;
    const active = current?.journey.activeCourse;
    const course = active ? getCourse(active.id) : null;
    const step = active && course ? course.steps.find(item => item.id === active.stepId) : null;
    if (!current || !active || !course || !step) return false;
    // Evidence is kept per kind for this run, so a notice that landed a moment before
    // the step turned over still satisfies it. It never satisfies a later run.
    const match = evidence.current.get(
      step.completion.type === "evidence" ? step.completion.kind : ""
    );
    if (step.completion.type === "evidence" && !match) {
      setError("还没看到可以确认的结果。请先完成页面上的操作。");
      return false;
    }
    const next = await act(() => ({
      action: "course-confirm", courseId: course.id, stepId: step.id, runId: active.runId,
      ...(step.completion.type === "evidence"
        ? { evidence: step.completion.kind, resourceId: match?.companionId ?? match?.groupId }
        : {})
    }));
    if (!next) return false;
    if (step.completion.type === "evidence") evidence.current.delete(step.completion.kind);
    if (!next.journey.activeCourse) setPhase("hidden");
    return true;
  }, [act]);

  // The evidence listener subscribes once; this ref keeps it on the latest confirm.
  const confirmRef = useRef(confirm);
  useEffect(() => { confirmRef.current = confirm; }, [confirm]);

  // A business success notice may satisfy the step currently waiting for it.
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<JourneyEvidence>).detail;
      if (!detail?.kind) return;
      if (userId !== undefined && detail.userId !== undefined && detail.userId !== userId) return;
      evidence.current.set(detail.kind, detail);
      const active = record.current?.journey.activeCourse;
      if (!active) return;
      const course = getCourse(active.id);
      const step = course?.steps.find(item => item.id === active.stepId);
      if (!step || step.completion.type !== "evidence" || step.completion.kind !== detail.kind) return;
      void confirmRef.current();
    };
    window.addEventListener(JOURNEY_EVIDENCE_EVENT, receive);
    return () => window.removeEventListener(JOURNEY_EVIDENCE_EVENT, receive);
  }, [userId]);

  // A notice that arrived just before the step turned over still satisfies the new
  // step, so the guide never asks the user to repeat an action it already saw.
  const settled = useRef<string | null>(null);
  const activeRunId = journey?.activeCourse?.runId;
  const activeStepId = journey?.activeCourse?.stepId;
  const eligibleKind = currentStep?.completion.type === "evidence" ? currentStep.completion.kind : null;
  useEffect(() => {
    if (!activeRunId || !activeStepId || !eligibleKind || busy) return;
    const key = `${activeRunId}:${activeStepId}`;
    if (settled.current === key) return;
    if (!evidence.current.has(eligibleKind)) return;
    settled.current = key;
    void Promise.resolve().then(() => { if (live.current) return confirmRef.current(); });
  }, [activeRunId, activeStepId, eligibleKind, busy]);

  const skipStep = useCallback(async () => {
    const active = record.current?.journey.activeCourse;
    if (!active) return false;
    const next = await act(() => ({ action: "course-skip-step", courseId: active.id, stepId: active.stepId, runId: active.runId }));
    if (!next) return false;
    return true;
  }, [act]);
  const back = useCallback(async () => {
    const current = record.current;
    const active = current?.journey.activeCourse;
    const course = active ? getCourse(active.id) : null;
    if (!current || !active || !course) return false;
    const index = course.steps.findIndex(step => step.id === active.stepId);
    if (index <= 0) return false;
    const target = course.steps[index - 1];
    // Rewind may only land on a reading step: practical steps are never re-run silently.
    if (!(target.kind === "story" || target.kind === "read" || target.kind === "navigate")) {
      setNotice("这一步已经产生过真实操作，返回只重新讲解，不会撤销。");
      return false;
    }
    const next = await act(() => ({ action: "course-rewind", courseId: course.id, stepId: target.id, runId: active.runId }));
    if (!next) return false;
    return true;
  }, [act]);

  const pause = useCallback(async () => {
    const active = record.current?.journey.activeCourse;
    if (!active) return false;
    const next = await act(() => ({ action: "course-pause" }));
    if (!next) return false;
    setPhase("paused");
    return true;
  }, [act]);

  const skipCourse = useCallback(async (result: "skipped" | "deferred" = "skipped") => {
    const active = record.current?.journey.activeCourse;
    if (!active) return false;
    const next = await act(() => ({ action: "course-leave", result }));
    if (!next) return false;
    setPhase("hidden");
    return true;
  }, [act]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setPhase("hidden");
    rememberSuppression(userId, true);
  }, [userId]);

  const openDirectory = useCallback(() => { setDirectoryOpen(true); setPhase("stepping"); }, []);
  const closeDirectory = useCallback(() => {
    setDirectoryOpen(false);
    if (!record.current?.journey.activeCourse) setPhase("hidden");
  }, []);

  const resetMain = useCallback(async () => {
    const next = await act(() => ({ action: "reset-main" }));
    if (!next) return false;
    evidence.current.clear();
    setDismissed(false);
    rememberSuppression(userId, false);
    setPhase("stepping");
    setDirectoryOpen(false);
    return true;
  }, [act, userId]);

  // A brand-new account is invited in once. Legacy accounts, finished courses and
  // anyone who dismissed the card are left alone.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !journey || suppressed(userId)) return;
    if (journey.status !== "active" || journey.activeCourse) return;
    if (Object.keys(journey.courses).length) return;
    autoStarted.current = true;
    // Deferred so the invitation never re-renders inside the reading effect.
    void Promise.resolve().then(() => { if (live.current) return start("main", { mode: "first" }); });
  }, [journey, start, userId]);

  // A branch the user has never walked on the page they are on: offer it quietly,
  // at most once per mount. Declining is persisted, so this never fights the user.
  const offered = useRef<string | null>(null);
  useEffect(() => {
    if (!invite || suppressed(userId) || journey?.activeCourse) return;
    if (phase !== "hidden") return;
    const key = `${invite.id}:${invite.contentVersion}`;
    if (offered.current === key) return;
    offered.current = key;
    void Promise.resolve().then(() => { if (live.current) setPhase(current => current === "hidden" ? "invite" : current); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite?.id, invite?.contentVersion]);

  const acceptInvite = useCallback(async () => {
    if (!invite) return false;
    setPhase("hidden");
    return start(invite.id, { mode: "first" });
  }, [invite, start]);

  const declineInvite = useCallback(async () => {
    if (!invite) return false;
    setPhase("hidden");
    await act(() => ({ action: "dismiss-invite", courseId: invite.id }));
    return true;
  }, [act, invite]);

  const reuseCompanion = useCallback(async (companionId: string) => {
    const next = await act(() => ({ action: "reuse-companion", resourceId: companionId, context: { companionId } }));
    if (!next) return false;
    evidence.current.clear();
    return true;
  }, [act]);

  return {
    phase, journey, course: currentCourse, step: currentStep, stepNumber, stepTotal, progress,
    invite, unmetRequirement, busy, error, notice, dismissed, directoryOpen,
    start, confirm, skipStep, back, pause, skipCourse, reuseCompanion, acceptInvite, declineInvite,
    dismiss, openDirectory, closeDirectory, reload: load, resetMain
  };
}
