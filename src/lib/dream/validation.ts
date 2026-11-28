import { invalid } from "./errors";
import type { DreamProfile, DreamScope, DreamState } from "./types";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) throw invalid();
  return value.trim();
}
export function scope(value: unknown): DreamScope {
  if (value !== "always" && value !== "context" && value !== "occasional") throw invalid();
  return value;
}
export function profile(value: unknown): DreamProfile {
  const row = object(value);
  if (Object.keys(row).some(key => !["personality", "speakingStyle"].includes(key)) || !Array.isArray(row.personality) || row.personality.length > 8) throw invalid();
  return { personality: row.personality.map(item => text(item, 80)), speakingStyle: text(row.speakingStyle, 4000, true) };
}
const labels = { always: "始终", context: "仅类似情境", occasional: "偶尔" };
export function preview(state: Pick<DreamState, "draftProfile" | "fragments" | "rounds">): DreamProfile {
  const notes = state.fragments.filter(f => f.confirmed).map(f => {
    const message = state.rounds.find(round => round.id === f.roundId)?.message;
    if (f.scope === "context" && !message) throw invalid();
    return f.scope === "context"
      ? `【仅类似练习情境时；以下为假设练习，不代表真实经历：${JSON.stringify(message!.slice(0, 250))}】${f.text}`
      : `【${labels[f.scope]}】${f.text}`;
  });
  return profile({ personality: [...state.draftProfile.personality], speakingStyle: [state.draftProfile.speakingStyle, ...notes].filter(Boolean).join("\n") });
}
export function boundState(state: DreamState): DreamState {
  if (state.rounds.length > 20 || state.versions.length > 10 || state.fragments.length > 40 || JSON.stringify(state).length > 180000) throw invalid();
  state.previewProfile = preview(state);
  state.updatedAt = new Date().toISOString();
  return state;
}
