import { capacity, invalid } from "./errors";
import type { GroupSettings, GroupState } from "./types";

export const BODY_BYTES = 100000;
export const DEFAULT_SETTINGS: GroupSettings = { proactiveEnabled: false, intervalMinutes: 1, maxReplies: 2, autoChat: false, maxAutoRounds: 3, quietStart: "23:00", quietEnd: "08:00" };
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw invalid();
  return value.trim();
}
export function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw invalid();
  return value as number;
}
export function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw invalid(); return value; }
export function ids(value: unknown, max = 12, min = 0): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw invalid();
  const result = value.map(id => text(id, 128));
  if (new Set(result).size !== result.length) throw invalid();
  return result;
}
export function settings(value: unknown): GroupSettings {
  const row = object(value);
  const time = (value: unknown) => { const result = text(value, 5); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw invalid(); return result; };
  return { proactiveEnabled: boolean(row.proactiveEnabled), intervalMinutes: integer(row.intervalMinutes, 1, 10080), maxReplies: integer(row.maxReplies, 1, 12), autoChat: boolean(row.autoChat), maxAutoRounds: integer(row.maxAutoRounds, 1, 20), quietStart: time(row.quietStart), quietEnd: time(row.quietEnd) };
}
export function boundState<T extends GroupState>(state: T): T {
  if (state.messages.length > 1000 || state.memories.length > 100 || new TextEncoder().encode(JSON.stringify(state)).length > 1000000) throw capacity();
  return state;
}
/** Count bytes while streaming, even if Content-Length is absent or dishonest. */
export async function readGroupBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "", bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > BODY_BYTES) { await reader.cancel(); throw invalid(); }
      body += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch { throw invalid(); }
  finally { reader.releaseLock(); }
}
