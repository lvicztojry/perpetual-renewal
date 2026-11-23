/** Shared by server and client imports; browser access happens only when called. */
import type { AbilityKind } from "./ability-catalog";
export type { AbilityKind } from "./ability-catalog";

export interface AbilityIntroRequest {
  kind: AbilityKind;
  companionName?: string;
  /** Explicit repeat: ~2s instead of ~6s. */
  short?: boolean;
  /** Start visuals immediately; sound requires a synchronous user gesture. */
  autoPlay?: boolean;
}

export const ABILITY_INTRO_EVENT = "renewal:ability-intro";
export const ABILITY_INTRO_STATE_EVENT = "renewal:ability-state";

export function publishAbilityIntroState(active: boolean): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ABILITY_INTRO_STATE_EVENT, { detail: { active } }));
}

/** Call after the destination is ready. No navigation, persistence or completion callback. */
export function playAbilityIntro(request: AbilityIntroRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AbilityIntroRequest>(ABILITY_INTRO_EVENT, { detail: request }));
}

export const dispatchAbilityIntro = playAbilityIntro;

/** Reserve the active slot synchronously, including before React renders a dialog. */
export function createAbilityIntroQueue<T>() {
  let active = false;
  const pending: T[] = [];
  return {
    /** Waiting scenes only; excludes the active scene. */
    get pendingCount(): number { return pending.length; },
    enqueue(value: T): T | undefined {
      if (active) { pending.push(value); return undefined; }
      active = true;
      return value;
    },
    next(): T | undefined {
      const value = pending.shift();
      active = value !== undefined;
      return value;
    },
    clear(): void { pending.length = 0; active = false; }
  };
}
