import { randomUUID } from "node:crypto";
import type { CompanionProfile } from "@/lib/renewal/types";
import { createDreamRepository, type DreamRepository } from "./repository";
import { conflict, invalid, missing } from "./errors";
import { boundState, object, profile, scope, text } from "./validation";
import { generateDreamChoices, inferDreamFeedback, type DreamModelDependencies } from "./model";
import type { DreamFragment, DreamPostResponse, DreamProfile, DreamState, DreamVersion } from "./types";

type Dependencies = DreamModelDependencies & { repository?: DreamRepository };
const currentProfile = (companion: CompanionProfile): DreamProfile => ({ personality: [...companion.personality], speakingStyle: companion.speakingStyle });
const version = (value: DreamProfile, kind: DreamVersion["kind"]): DreamVersion => ({ id: randomUUID(), profile: structuredClone(value), kind, createdAt: new Date().toISOString() });
const revision = (state: DreamState | null, value: unknown) => {
  if (!state) throw missing();
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw invalid();
  if (state.revision !== value) throw conflict();
  return state;
};
function fresh(companion: CompanionProfile, prior: DreamState | null): DreamState {
  const draftProfile = currentProfile(companion);
  return { id: prior?.id ?? randomUUID(), companionId: companion.id, revision: (prior?.revision ?? 0) + 1, status: "draft", baseCompanionUpdatedAt: companion.updatedAt, draftProfile, previewProfile: structuredClone(draftProfile), fragments: [], rounds: [], versions: prior?.versions ?? [], updatedAt: new Date().toISOString() };
}
export class DreamService {
  private readonly repository: DreamRepository;
  constructor(private readonly deps: Dependencies = {}) { this.repository = deps.repository ?? createDreamRepository(); }
  get(userId: string, companionId: string) { return this.repository.read(userId, companionId); }
  async post(userId: string, companionId: string, value: unknown): Promise<DreamPostResponse> {
    // Ownership always precedes input validation, including unknown actions.
    const snapshot = await this.repository.read(userId, companionId);
    const input = object(value);
    if (JSON.stringify(input).length > 35000) throw invalid();
    if (input.action === "start") {
      const result = await this.repository.mutate(userId, companionId, (companion, state) => ({ state: state?.status === "draft" ? state : boundState(fresh(companion, state)) }));
      return { state: result.state };
    }
    const state = revision(snapshot.state, input.revision);
    let source: "local" | "model" | undefined;
    let generated: Awaited<ReturnType<typeof generateDreamChoices>> | undefined;
    let feedback: Awaited<ReturnType<typeof inferDreamFeedback>> | undefined;
    let message = "", selectedScope: ReturnType<typeof scope> = "always", correction: string | undefined, choiceId: string | undefined;
    if (!["generate", "feedback", "edit", "apply", "discard", "restore", "rebase"].includes(String(input.action))) throw invalid();
    if (input.action !== "restore" && input.action !== "rebase" && state.status !== "draft") throw conflict();
    if (input.action === "generate") {
      if (state.rounds.length >= 20 || (input.mode !== "compare" && input.mode !== "free")) throw invalid();
      message = text(input.message, 2000);
      generated = await generateDreamChoices(userId, companionId, { companion: snapshot.companion, name: snapshot.companion.name, profile: state.previewProfile, message, mode: input.mode, history: state.rounds }, this.deps);
      source = generated.source;
    }
    if (input.action === "feedback") {
      const round = state.rounds.find(round => round.id === input.roundId);
      if (!round) throw invalid();
      if (round.feedback) throw conflict();
      selectedScope = scope(input.scope);
      if (input.choiceId !== undefined) {
        choiceId = text(input.choiceId, 100);
        if (!round.choices.some(choice => choice.id === choiceId)) throw invalid();
      }
      if (input.correction !== undefined) correction = text(input.correction, 500, true) || undefined;
      if (!choiceId && !correction) throw invalid();
      feedback = await inferDreamFeedback(userId, companionId, round, choiceId, correction, selectedScope, this.deps);
      source = feedback.source;
    }
    const result = await this.repository.mutate(userId, companionId, (companion, latest) => {
      const next = structuredClone(revision(latest, input.revision));
      let writeProfile: DreamProfile | undefined;
      if (input.action === "rebase") {
        if (input.expectedCompanionUpdatedAt !== companion.updatedAt) throw conflict();
        next.baseCompanionUpdatedAt = companion.updatedAt;
      } else if (input.action === "generate") {
        next.rounds.push({ id: randomUUID(), message, mode: input.mode as "compare" | "free", choices: generated!.contents.map(content => ({ id: randomUUID(), content })), source: generated!.source, createdAt: new Date().toISOString() });
      } else if (input.action === "feedback") {
        const round = next.rounds.find(round => round.id === input.roundId)!;
        if (round.feedback) throw conflict();
        round.feedback = { scope: selectedScope, ...(choiceId ? { choiceId } : {}), ...(correction ? { correction } : {}) };
        if (feedback!.fragment) next.fragments.push({ id: randomUUID(), roundId: round.id, text: feedback!.fragment, scope: selectedScope, origin: feedback!.origin, confirmed: false });
      } else if (input.action === "edit") {
        next.draftProfile = profile(input.draftProfile);
        if (!Array.isArray(input.fragments) || input.fragments.length > 40) throw invalid();
        const seen = new Set<string>();
        next.fragments = input.fragments.map(value => {
          const row = object(value);
          const existing = next.fragments.find(fragment => fragment.id === row.id);
          if (!existing || seen.has(existing.id) || row.roundId !== existing.roundId || typeof row.confirmed !== "boolean") throw invalid();
          seen.add(existing.id);
          const editedText = text(row.text, 500);
          return { ...existing, text: editedText, scope: scope(row.scope), confirmed: row.confirmed, origin: editedText !== existing.text ? "user" : existing.origin } satisfies DreamFragment;
        });
      } else if (input.action === "apply" || input.action === "restore") {
        if (companion.updatedAt !== next.baseCompanionUpdatedAt) throw conflict();
        if (input.action === "apply") {
          // Pending fragments never enter the preview or the persisted profile.
          writeProfile = boundState(next).previewProfile;
        } else {
          const target = next.versions.find(item => item.id === input.versionId);
          if (!target) throw invalid();
          writeProfile = structuredClone(target.profile);
          next.draftProfile = structuredClone(writeProfile);
          next.fragments = [];
        }
        // Capture the actual pre-write profile, including edits outside previous dreams.
        if (!next.versions.length || JSON.stringify(next.versions.at(-1)!.profile) !== JSON.stringify(currentProfile(companion))) next.versions.push(version(currentProfile(companion), "initial"));
        next.versions.push(version(writeProfile, input.action));
        if (next.versions.length > 10) next.versions = [next.versions[0], ...next.versions.slice(-9)];
        next.status = "applied";
      } else if (input.action === "discard") {
        next.status = "discarded"; next.rounds = []; next.fragments = []; next.draftProfile = currentProfile(companion);
      }
      next.revision++;
      boundState(next);
      if (writeProfile) next.previewProfile = structuredClone(writeProfile);
      return { state: next, profile: writeProfile };
    });
    return { state: result.state, ...(input.action === "apply" || input.action === "restore" ? { companion: result.companion } : {}), ...(source ? { source } : {}) };
  }
}
