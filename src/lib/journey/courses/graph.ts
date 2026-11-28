import type { JourneyStep } from "../types";
import type { CourseDefinition, CourseStep, EvidenceKind } from "./types";

/** Pure course-graph transitions. No I/O, no clock, no randomness. */
export type StepOutcome = {
  stepId: string;
  /** Main-line chapter projection, when the step declares one. */
  chapter?: JourneyStep;
  /** Evidence kind recorded for this step, if it had one. */
  evidence?: EvidenceKind;
  /** True when the step ends its course. */
  finished: boolean;
};

export function resolveStep(course: CourseDefinition, stepId: string): CourseStep | null {
  return course.steps.find(step => step.id === stepId) ?? null;
}

/**
 * Advance after a step's completion.
 * `mainStep` returns the new main-line chapter step for main-course progress.
 */
export function advance(course: CourseDefinition, stepId: string, completed = true): StepOutcome | null {
  const step = resolveStep(course, stepId);
  if (!step) return null;
  const next = step.next ? resolveStep(course, step.next) : null;
  return {
    stepId: next?.id ?? step.id,
    ...(next?.chapter ? { chapter: next.chapter } : {}),
    ...(step.completion.type === "evidence" && completed ? { evidence: step.completion.kind } : {}),
    finished: !next
  };
}

/** Reviewing may rewind to any earlier step of the same course. */
export function rewindIndex(course: CourseDefinition, fromStepId: string, toStepId: string): number {
  const from = course.steps.findIndex(step => step.id === fromStepId);
  const to = course.steps.findIndex(step => step.id === toStepId);
  if (from < 0 || to < 0) return -1;
  return to <= from ? to : -1;
}

/** Every explicit end step, used to classify a course run as `learned`. */
export function terminalSteps(course: CourseDefinition): CourseStep[] {
  return course.steps.filter(step => !step.next);
}

/** The furthest step a course can resume from without replaying evidence. */
export function checkpointFor(course: CourseDefinition, stepId: string | null): string | null {
  if (!stepId) return null;
  return resolveStep(course, stepId)?.id ?? null;
}
