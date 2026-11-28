import type { JourneyStep } from "../types";

/** A step's interaction verb. Never a substitute for an explicit completion rule. */
export type StepKind = "story" | "read" | "navigate" | "input" | "action" | "wait" | "review";
/** How strict the overlay is. Guided blocks everything but the target and the guide card. */
export type InteractionPolicy = "guided" | "free";
/** A page adapter capability the guide may invoke without touching the DOM directly. */
export type GuideCapability =
  | "open-create-person"
  | "open-people"
  | "open-chat"
  | "open-dream"
  | "open-memory"
  | "open-import"
  | "open-groups"
  | "open-settings"
  | "open-course-directory";

/**
 * Business evidence the server re-checks before a milestone is recorded.
 * Every entry below is checkable against persisted resources and a baseline taken
 * when the course started. UI-only actions stay `confirm` steps instead.
 */
export type EvidenceKind =
  | "companion-created"
  | "companion-updated"
  | "message-sent"
  | "assistant-replied"
  | "dream-started"
  | "dream-generated"
  | "dream-feedback-recorded"
  | "dream-applied"
  | "group-created"
  | "group-message-sent"
  | "memory-confirmed"
  | "settings-saved";

export type StepCompletion =
  | { type: "confirm" }
  | { type: "evidence"; kind: EvidenceKind };

export type CourseStep = {
  /** Stable; never renamed with copy edits. */
  id: string;
  kind: StepKind;
  /** Main-line chapter this step belongs to. Independent courses omit it. */
  chapter?: JourneyStep;
  /** `data-guide` anchor key the step points at. */
  target?: string | null;
  /** Short heading shown above the dialogue, e.g. “描摹 · 想见的人”. */
  title?: string;
  /** Path the step navigates to; arriving there completes the step by itself. */
  arrivePath?: string;
  dialogue: string[];
  instruction?: string;
  /** Story-only local choices. The picked answer never leaves the browser. */
  choices?: Array<{ label: string; reply: string }>;
  completion: StepCompletion;
  /** Next step ID, or null when this step ends the course. */
  next?: string | null;
  /** Context the step requires before it can run. */
  requires?: "companion" | "group" | "none";
  policy?: InteractionPolicy;
  /** Adapter capability offered as a recovery aid, never auto-invoked for writes. */
  capability?: GuideCapability;
};

export type CourseDefinition = {
  id: string;
  title: string;
  chapterTitle: string;
  contentVersion: number;
  /** Entry requirement summary shown in the directory. */
  prerequisite: string;
  /** Problem statement used when the prerequisite cannot be met. */
  fallbackCopy: string;
  steps: CourseStep[];
  mode?: "main" | "course";
};

export function stepIndex(course: CourseDefinition, stepId: string): number {
  return course.steps.findIndex(step => step.id === stepId);
}

export function findStep(course: CourseDefinition, stepId: string): CourseStep | undefined {
  return course.steps.find(step => step.id === stepId);
}

export function firstStep(course: CourseDefinition): CourseStep {
  return course.steps[0];
}
