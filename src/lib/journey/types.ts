export const journeySteps = ["awakening", "arrival", "lanterns", "creation", "conversation", "dream", "complete"] as const;
export type JourneyStep = typeof journeySteps[number];
export type JourneyStatus = "legacy" | "active" | "paused" | "completed" | "skipped";
export type JourneyState = { version: 1; step: JourneyStep; status: JourneyStatus; companionId: string | null; revision: number };
export type JourneyResponse = { userId: string; journey: JourneyState };
export type JourneyInput = {
  action: "start" | "resume" | "pause" | "skip" | "advance" | "observe";
  expectedRevision: number;
  step?: JourneyStep;
  kind?: "companion-created" | "message-sent" | "dream-started";
  companionId?: string;
};
export const initialJourney = (status: JourneyStatus = "legacy"): JourneyState => ({ version: 1, step: "awakening", status, companionId: null, revision: 0 });
