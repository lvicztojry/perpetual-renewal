/** Shared browser/native integration. Emit observations only after a successful operation. */
export const OPEN_JOURNEY_EVENT = "renewal:journey-open";
export const CREATE_JOURNEY_EVENT = "renewal:journey-create";
export const OBSERVE_JOURNEY_EVENT = "renewal:journey-observe";

export interface JourneyObservation {
  kind: "companion-created" | "message-sent" | "dream-started";
  companionId: string;
  userId?: string;
}
