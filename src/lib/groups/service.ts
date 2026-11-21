import { randomUUID } from "node:crypto";
import type { CompanionProfile } from "@/lib/renewal/types";
import { getUserProfile, type UserProfile } from "@/lib/users/profile";
import { generateGroupReply, selectGroupSpeakers } from "./generation";
import { createGroupRepository, publicGroup, type GroupRepository, type ReplyClaim, type StoredGroup } from "./repository";
import { capacity, conflict, GroupError, invalid, modelFailure, missing } from "./errors";
import { boolean, boundState, DEFAULT_SETTINGS, ids, integer, object, settings, text } from "./validation";
import type { GroupMember, GroupResult, GroupState, GroupSummary } from "./types";

export const GROUP_GENERATION_TIMEOUT_MS = 45000;
export const GROUP_CLAIM_LEASE_MS = 90000;
export const GROUP_MAX_REPLY_ATTEMPTS = 3;
// Older snapshots have claims without lease metadata: allow recovery, counting
// the original invocation as attempt one rather than granting unlimited retries.
const attempts = (claim?: ReplyClaim) => claim ? (Number.isSafeInteger(claim.attempts) && claim.attempts > 0 ? claim.attempts : 1) : 0;
const liveClaim = (claim: ReplyClaim | undefined, now: string) => claim?.status === "pending" && Date.parse(claim.leaseUntil) > Date.parse(now);

export type GroupDependencies = {
  repository?: GroupRepository;
  selectGroupSpeakers?: (group: GroupState, companions: CompanionProfile[], mentionIds?: string[]) => string[];
  generateGroupReply?: (userId: string, group: GroupState, companions: CompanionProfile[], speakerId: string, proactive?: boolean) => Promise<{ content: string; source: "local" | "model" }>;
  getUserProfile?: (userId: string) => Promise<Pick<UserProfile, "proactiveMessagesEnabled" | "timezone">>;
  now?: () => Date;
};
export class GroupService {
  private readonly repository: GroupRepository;
  constructor(private readonly deps: GroupDependencies = {}) { this.repository = deps.repository ?? createGroupRepository(); }
  private now() { return (this.deps.now?.() ?? new Date()).toISOString(); }
  private messageTime(state: GroupState, now: string) {
    return new Date(Math.max(Date.parse(now), ...state.members.map(m => Date.parse(m.joinedAt)), ...state.messages.map(m => Date.parse(m.createdAt) + 1))).toISOString();
  }
  async list(userId: string): Promise<GroupSummary[]> {
    return (await this.repository.list(userId)).map(g => ({ id: g.id, name: g.name, updatedAt: g.updatedAt, members: g.members, settings: g.settings, lastMessage: g.messages.at(-1) ?? null }));
  }
  async get(userId: string, id: string): Promise<GroupState> { return publicGroup(await this.repository.read(userId, id)); }
  /** Owned delivery progress for reconnecting native clients; never expose claim tokens. */
  async progress(userId: string, id: string) {
    const state = await this.repository.read(userId, id);
    const plan = state._control.plan;
    return { turn: state.turn, speakers: plan?.turn === state.turn ? plan.speakers.filter(id => plan.claims[id]?.status !== "done") : [] };
  }
  async create(userId: string, value: unknown): Promise<GroupState> {
    const input = object(value), companionIds = ids(input.companionIds, 12, 1);
    const owned = await this.repository.companions(userId);
    if (companionIds.some(id => !owned.some(c => c.id === id))) throw missing();
    const now = this.now();
    const state: StoredGroup = { id: randomUUID(), userId, name: text(input.name, 80), background: text(input.background ?? "", 4000, true), members: companionIds.map(companionId => ({ companionId, joinedAt: now, allowPrivateMemories: false, proactiveEnabled: true, relationship: "" })), messages: [], memories: [], settings: { ...DEFAULT_SETTINGS }, revision: 1, turn: 0, lastActivityAt: now, lastProactiveAt: null, createdAt: now, updatedAt: now, _control: { plan: null, deliveries: {}, autoRounds: 0 } };
    return publicGroup(await this.repository.create(state));
  }
  async delete(userId: string, id: string): Promise<void> { await this.repository.delete(userId, id); }
  private async companions(userId: string, state: GroupState) {
    return (await this.repository.companions(userId)).filter(c => state.members.some(m => m.companionId === c.id));
  }
  private speakers(state: GroupState, companions: CompanionProfile[], mentionIds?: string[]) {
    const selected = (this.deps.selectGroupSpeakers ?? selectGroupSpeakers)(publicGroup(state as StoredGroup), companions, mentionIds);
    if (!Array.isArray(selected) || selected.some(id => !companions.some(c => c.id === id))) throw invalid();
    return [...new Set(selected)].slice(0, state.settings.maxReplies);
  }
  async post(userId: string, id: string, value: unknown): Promise<GroupResult> {
    const snapshot = await this.repository.read(userId, id);
    const input = object(value);
    if (new TextEncoder().encode(JSON.stringify(input)).length > 100000) throw invalid();
    if (input.action === "reply") return this.reply(userId, id, integer(input.turn, 1), text(input.speakerId, 128));
    if (input.action === "proactive") return this.proactive(userId, id);
    const companions = await this.companions(userId, snapshot);
    if (input.action === "message") {
      const content = text(input.content, 8000), clientId = text(input.clientId, 128), mentions = input.mentionIds === undefined ? [] : ids(input.mentionIds);
      if (mentions.some(id => !companions.some(c => c.id === id))) throw invalid();
      const existing = snapshot.messages.find(m => m.clientId === clientId);
      if (existing) {
        const delivery = snapshot._control.deliveries[clientId];
        if (existing.content !== content || JSON.stringify(delivery?.mentionIds ?? []) !== JSON.stringify(mentions)) throw conflict();
        return { group: publicGroup(snapshot), speakers: delivery?.speakers ?? [] };
      }
      const now = this.now();
      const group = await this.repository.mutate(userId, id, state => {
        const prior = state.messages.find(m => m.clientId === clientId);
        if (prior) { if (prior.content !== content || JSON.stringify(state._control.deliveries[clientId]?.mentionIds ?? []) !== JSON.stringify(mentions)) throw conflict(); return state; }
        state.turn++; state._control.autoRounds = 0;
        const createdAt = this.messageTime(state, now);
        state.messages.push({ id: randomUUID(), clientId, speakerId: null, content, createdAt, proactive: false });
        // Explicit mentions feed the deterministic plan and are retained for idempotency.
        const selected = this.speakers(state, companions, mentions);
        state._control.plan = { turn: state.turn, speakers: selected, proactive: false, claims: {} };
        state._control.deliveries = { ...state._control.deliveries, [clientId]: { turn: state.turn, speakers: selected, mentionIds: mentions } };
        state.lastActivityAt = createdAt; state.updatedAt = createdAt;
        return boundState(state);
      });
      return { group: publicGroup(group), speakers: group._control.deliveries[clientId].speakers };
    }
    if (!["update", "remember", "forget"].includes(String(input.action))) throw invalid();
    integer(input.revision, 1);
    const ownedForUpdate = input.action === "update" ? await this.repository.companions(userId) : [];
    const now = this.now();
    const group = await this.repository.mutate(userId, id, state => {
      if (state.revision !== input.revision) throw conflict();
      if (input.action === "update") {
        if (!Array.isArray(input.members) || !input.members.length || input.members.length > 12) throw invalid();
        const seen = new Set<string>();
        const members: GroupMember[] = input.members.map(value => {
          const row = object(value), companionId = text(row.companionId, 128);
          if (seen.has(companionId) || !ownedForUpdate.some(c => c.id === companionId)) throw invalid();
          seen.add(companionId);
          // The client never controls attendance timestamps, including for re-joining members.
          const joinedAt = state.members.find(m => m.companionId === companionId)?.joinedAt ?? new Date(Math.max(Date.parse(now), ...state.messages.map(m => Date.parse(m.createdAt) + 1))).toISOString();
          return { companionId, joinedAt, allowPrivateMemories: boolean(row.allowPrivateMemories), proactiveEnabled: boolean(row.proactiveEnabled), relationship: text(row.relationship, 500, true) };
        });
        state.name = text(input.name, 80); state.background = text(input.background, 4000, true); state.settings = settings(input.settings); state.members = members;
        state._control.plan = null; // Membership/settings edits cancel in-flight results too.
      } else if (input.action === "remember") {
        if (state.memories.length >= 100) throw capacity();
        const sourceMessageIds = ids(input.sourceMessageIds, 30, 1), knownBy = ids(input.knownBy, 12, 1);
        const sources = sourceMessageIds.map(id => { const m = state.messages.find(m => m.id === id); if (!m) throw invalid(); return m; });
        for (const id of knownBy) {
          const member = state.members.find(m => m.companionId === id);
          if (!member || !companions.some(c => c.id === id) || sources.some(m => Date.parse(m.createdAt) < Date.parse(member.joinedAt))) throw invalid();
        }
        state.memories.push({ id: randomUUID(), content: text(input.content, 2000), sourceMessageIds, knownBy, confirmed: true, createdAt: now });
      } else {
        const memoryId = text(input.memoryId, 128);
        if (!state.memories.some(m => m.id === memoryId)) throw missing();
        state.memories = state.memories.filter(m => m.id !== memoryId);
      }
      state.updatedAt = now;
      return boundState(state);
    });
    return { group: publicGroup(group) };
  }
  private async reply(userId: string, id: string, turn: number, speakerId: string): Promise<GroupResult> {
    const snapshot = await this.repository.read(userId, id);
    const previousPlan = snapshot._control.plan;
    if (snapshot.turn !== turn || previousPlan?.turn !== turn || !previousPlan.speakers.includes(speakerId)) throw conflict();
    if (previousPlan.claims[speakerId]?.status === "done") return { group: publicGroup(snapshot), source: previousPlan.claims[speakerId].source };
    const companions = await this.companions(userId, snapshot);
    if (!companions.some(c => c.id === speakerId)) throw missing();
    if (snapshot.messages.length >= 1000) throw capacity();
    const profile = await (this.deps.getUserProfile ?? getUserProfile)(userId);
    const token = randomUUID();
    let completed = false, exhausted = false;
    const claimed = await this.repository.mutate(userId, id, state => {
      const plan = state._control.plan;
      if (state.turn !== turn || !plan || plan.turn !== turn || !plan.speakers.includes(speakerId)) throw conflict();
      const previous = Object.hasOwn(plan.claims, speakerId) ? plan.claims[speakerId] : undefined;
      if (previous?.status === "done") { completed = true; return state; }
      if (liveClaim(previous, this.now())) throw conflict();
      if (attempts(previous) >= GROUP_MAX_REPLY_ATTEMPTS) { exhausted = true; return state; }
      if (plan.proactive && (!profile || this.automaticBlocked(state, profile, companions, speakerId, this.now()))) throw conflict();
      // Preserve the selected order, so later speakers see earlier persisted replies.
      if (plan.speakers.slice(0, plan.speakers.indexOf(speakerId)).some(id => plan.claims[id]?.status !== "done")) throw conflict();
      const claimedAt = this.now();
      plan.claims = { ...plan.claims, [speakerId]: { token, status: "pending", claimedAt, leaseUntil: new Date(Date.parse(claimedAt) + GROUP_CLAIM_LEASE_MS).toISOString(), attempts: attempts(previous) + 1 } }; return state;
    });
    if (completed) return { group: publicGroup(claimed), source: claimed._control.plan!.claims[speakerId].source };
    if (exhausted) return { group: publicGroup(claimed), skipped: "reply-attempts-exhausted" };
    let generated: { content: string; source: "local" | "model" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      generated = await Promise.race([
        (this.deps.generateGroupReply ?? generateGroupReply)(userId, publicGroup(claimed), companions, speakerId, claimed._control.plan!.proactive, { now: this.now(), timeZone: profile.timezone }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(modelFailure()), GROUP_GENERATION_TIMEOUT_MS); })
      ]);
      generated.content = text(generated.content, 8000);
      if (generated.source !== "local" && generated.source !== "model") throw invalid();
    } catch {
      await this.repository.mutate(userId, id, state => { const claim = state._control.plan?.claims[speakerId]; if (claim?.token === token) claim.status = "failed"; return state; }).catch(() => undefined);
      throw modelFailure();
    } finally { if (timer !== undefined) clearTimeout(timer); }
    // Re-read current ownership immediately before committing any model result.
    const owned = await this.repository.companions(userId);
    if (!owned.some(c => c.id === speakerId)) return { group: await this.get(userId, id), skipped: "speaker-unavailable" };
    const latestProfile = claimed._control.plan!.proactive ? await (this.deps.getUserProfile ?? getUserProfile)(userId) : undefined;
    const now = this.now();
    let stale = false;
    const group = await this.repository.mutate(userId, id, state => {
      const plan = state._control.plan;
      if (state.turn !== turn || plan?.turn !== turn || plan.claims[speakerId]?.token !== token || !liveClaim(plan.claims[speakerId], now)) { stale = true; return state; }
      if (plan.proactive && (!latestProfile || this.automaticBlocked(state, latestProfile, owned, speakerId, now))) { plan.claims[speakerId].status = "failed"; stale = true; return state; }
      plan.claims[speakerId].status = "done";
      plan.claims[speakerId].source = generated.source;
      const createdAt = this.messageTime(state, now);
      state.messages.push({ id: randomUUID(), speakerId, content: generated.content, proactive: plan.proactive, createdAt });
      state.lastActivityAt = createdAt; state.updatedAt = createdAt;
      return boundState(state);
    });
    return { group: publicGroup(group), ...(stale ? { skipped: "stale-turn" } : { source: generated.source }) };
  }
  private automaticBlocked(state: GroupState, profile: Pick<UserProfile, "timezone" | "proactiveMessagesEnabled">, companions: CompanionProfile[], speakerId: string | undefined, now: string): string | undefined {
    if (!profile.proactiveMessagesEnabled || !state.settings.proactiveEnabled) return "disabled";
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: profile.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now));
    const { quietStart: start, quietEnd: end } = state.settings;
    if (start !== end && (start < end ? clock >= start && clock < end : clock >= start || clock < end)) return "quiet-time";
    if (speakerId && (!state.members.some(m => m.companionId === speakerId && m.proactiveEnabled) || !companions.some(c => c.id === speakerId))) return "member-disabled";
  }
  private proactiveReason(state: StoredGroup, profile: Pick<UserProfile, "timezone" | "proactiveMessagesEnabled">, companions: CompanionProfile[], now: string): string | undefined {
    const blocked = this.automaticBlocked(state, profile, companions, undefined, now);
    if (blocked) return blocked;
    const elapsed = Date.parse(now) - Math.max(Date.parse(state.lastActivityAt), state.lastProactiveAt ? Date.parse(state.lastProactiveAt) : 0);
    if (elapsed < state.settings.intervalMinutes * 60000) return "frequency";
    if (state._control.autoRounds >= state.settings.maxAutoRounds || state._control.autoRounds > 0 && !state.settings.autoChat) return "max-auto-rounds";
    if (state._control.plan?.speakers.some(id => liveClaim(state._control.plan!.claims[id], now))) return "reply-in-progress";
    if (!companions.length) return "no-speakers";
  }
  private async proactive(userId: string, id: string): Promise<GroupResult> {
    const snapshot = await this.repository.read(userId, id);
    const profile = await (this.deps.getUserProfile ?? getUserProfile)(userId);
    const owned = await this.companions(userId, snapshot);
    const eligible = owned.filter(c => snapshot.members.some(m => m.companionId === c.id && m.proactiveEnabled));
    const now = this.now(); let skipped: string | undefined, speakers: string[] = [];
    const group = await this.repository.mutate(userId, id, state => {
      const currentEligible = eligible.filter(c => state.members.some(m => m.companionId === c.id && m.proactiveEnabled));
      skipped = this.automaticBlocked(state, profile, currentEligible, undefined, now);
      if (skipped) return state;
      const plan = state._control.plan;
      const remaining = plan?.speakers.filter(id => plan.claims[id]?.status !== "done") ?? [];
      if (plan?.proactive && remaining.length) {
        const nextId = remaining[0], claim = plan.claims[nextId];
        skipped = this.automaticBlocked(state, profile, currentEligible, nextId, now);
        if (skipped) return state;
        if (liveClaim(claim, now)) { skipped = "reply-in-progress"; return state; }
        if (attempts(claim) >= GROUP_MAX_REPLY_ATTEMPTS) { skipped = "reply-attempts-exhausted"; return state; }
        // Recovery keeps the same turn/round and bypasses the NEW-round interval
        // and maxAutoRounds checks. Each speaker still has a bounded CAS lease.
        speakers = remaining; return state;
      }
      skipped = this.proactiveReason(state, profile, currentEligible, now);
      if (skipped) return state;
      speakers = this.speakers(state, currentEligible);
      if (!speakers.length) { skipped = currentEligible.length && state.settings.autoChat ? "conversation-settled" : "no-speakers"; return state; }
      if (state.messages.length + speakers.length > 1000) throw capacity();
      state.turn++; state._control.autoRounds++; state.lastProactiveAt = now; state.updatedAt = now;
      state._control.plan = { turn: state.turn, speakers, proactive: true, claims: {} };
      return state;
    });
    return { group: publicGroup(group), ...(skipped ? { skipped } : { speakers }) };
  }
  /** Cron convenience: plan once then deliver in order using the same persisted claims. */
  async scheduled(userId: string, id: string): Promise<GroupResult> {
    let result = await this.proactive(userId, id);
    const turn = result.group.turn;
    for (const speakerId of result.speakers ?? []) {
      try { result = await this.reply(userId, id, turn, speakerId); }
      catch (error) {
        // Another cron/client may have acquired the same lease or advanced the
        // plan after planning. Never retry CAS conflicts around a paid call.
        if (error instanceof GroupError && error.status === 409) return { group: await this.get(userId, id), skipped: "plan-changed" };
        throw error;
      }
      if (result.skipped) break;
    }
    return result;
  }
}
