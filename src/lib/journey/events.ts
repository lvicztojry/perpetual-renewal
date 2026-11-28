import type { EvidenceKind } from "./courses/types";

/**
 * Shared browser/native integration.
 * Observations are emitted only after a successful operation; the guide re-checks them server-side.
 */
export const OPEN_JOURNEY_EVENT = "renewal:journey-open";
export const CREATE_JOURNEY_EVENT = "renewal:journey-create";
export const OBSERVE_JOURNEY_EVENT = "renewal:journey-observe";

/** Legacy v1 observations, still accepted by the server for an older client. */
export interface JourneyObservation {
  kind: "companion-created" | "message-sent" | "dream-started";
  companionId: string;
  userId?: string;
}

/** Richer evidence notice so the guide can advance an evidence step it is waiting on. */
export interface JourneyEvidence {
  kind: EvidenceKind;
  userId?: string;
  companionId?: string;
  groupId?: string;
  resourceId?: string;
}

export const JOURNEY_EVIDENCE_EVENT = "renewal:journey-evidence";

/** Emit after the business call confirmed success. Never before. */
export function reportJourneyEvidence(detail: JourneyEvidence): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<JourneyEvidence>(JOURNEY_EVIDENCE_EVENT, { detail }));
}

/** Page adapters register their `data-guide` presence here instead of the guide querying the DOM. */
export const JOURNEY_PAGE_EVENT = "renewal:journey-page";

export interface JourneyPageState {
  path: string;
  ready: boolean;
  /** Anchors present on the page, so recovery copy can be honest before measuring. */
  anchors: string[];
  companionId?: string;
  groupId?: string;
  /** Native dialog currently hosting tutorial UI, if any. */
  hostId?: string;
}
