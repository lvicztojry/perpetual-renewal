import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import * as ts from "typescript";
import { loadLocalEnv } from "../scripts/load-local-env.mjs";

if (process.env.VAULT_PROVIDER_QA !== "1") {
  console.log("Saved-vault provider QA skipped: set VAULT_PROVIDER_QA=1 to opt in.");
  process.exit(0);
}
loadLocalEnv();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);
// Optional one-run override never writes the user's saved model selection.
const modelOverride = process.argv.find((arg) => arg.startsWith("--model="))?.slice(8);
const prisma = new PrismaClient({ log: [] });
const reader = new PrismaClient({ log: [] });
const modules = new Map();
function load(path) {
  if (!existsSync(path)) path = resolve(path.slice(0, -3), "index.ts");
  if (modules.has(path)) return modules.get(path).exports;
  const loaded = { exports: {} };
  modules.set(path, loaded);
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const scopedRequire = (id) => {
    if (id === "@/lib/prisma") return { prisma };
    if (id === "@/lib/llm/user-provider" && modelOverride) {
      const actual = load(resolve(root, "src/lib/llm/user-provider.ts"));
      return { async createUserLlmProvider(userId) {
        const provider = await actual.createUserLlmProvider(userId);
        return { name: provider.name, complete: (options) => provider.complete({ ...options, model: modelOverride }) };
      } };
    }
    if (id.startsWith("@/")) return load(resolve(root, "src", `${id.slice(2)}.ts`));
    if (id.startsWith(".")) return load(resolve(dirname(path), `${id}.ts`));
    return nativeRequire(id);
  };
  new Function("require", "module", "exports", "console", output)(
    scopedRequire, loaded, loaded.exports, { ...console, warn() {}, error() {} }
  );
  return loaded.exports;
}

let service;
let companionId;
let step = "database and vault environment readiness";
try {
  assert(process.env.DATABASE_URL && process.env.USER_KEY_VAULT_SECRET);
  step = "QA account email configuration";
  const email = process.env.QA_USER_EMAIL || process.env.AUTH_SMTP_USER;
  assert(email);
  step = "QA account lookup";
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  assert(user);
  step = "active saved credential lookup";
  const credential = await prisma.providerCredential.findUnique({
    where: { userId_kind: { userId: user.id, kind: "llm" } },
    select: { status: true, model: true }
  });
  assert.equal(credential?.status, "active");
  step = "saved model selection";
  assert(credential.model);
  if (process.argv.includes("--models")) {
    step = "saved-vault model listing";
    const { listAvailableLlmModels } = load(resolve(root, "src/lib/llm/model-list.ts"));
    const listing = await listAvailableLlmModels(user.id);
    const candidates = listing.models.map((model) => model.id)
      .filter((id) => /^[a-z0-9._:/-]{1,120}$/i.test(id) && /mini|flash|qwen.*plus/i.test(id)).slice(0, 12);
    console.log(JSON.stringify({ count: listing.models.length,
      selectedModelListed: listing.models.some((model) => model.id === credential.model), candidates }));
  } else {
  if (modelOverride) {
    step = "validate temporary model selection";
    const { listAvailableLlmModels } = load(resolve(root, "src/lib/llm/model-list.ts"));
    assert((await listAvailableLlmModels(user.id)).models.some((model) => model.id === modelOverride));
  }
  const { getRenewalService } = load(resolve(root, "src/lib/renewal/service.ts"));
  const { createRenewalRepository } = load(resolve(root, "src/lib/renewal/repository.ts"));
  const { createProactiveDraftPlan } = load(resolve(root, "src/lib/relationship/proactive.ts"));
  const { personalizeProactiveDraft } = load(resolve(root, "src/lib/relationship/proactive-model.ts"));
  const repository = createRenewalRepository();
  assert.equal(repository.persistence, "prisma");
  service = getRenewalService(user.id);
  step = "create temporary QA companion";
  const companion = await service.createCompanion({
    name: `QA-${Date.now()}`, relationshipKind: "CUSTOM", customKind: "临时联调对象",
    speakingStyle: "自然简短的中文，不用 Markdown 星号。", personality: ["温柔", "简洁"],
    proactiveMessagesEnabled: true, proactiveFrequencyPreset: "1m", proactiveFrequencyMinutes: 1
  });
  companionId = companion.id;
  step = "real provider reply";
  const result = await service.sendMessage(companion.conversationId, "请用一句简短的中文回应：今天想和你说说话。");
  if (result?.assistantError) {
    const allowedKinds = new Set(["configuration", "authentication", "rate_limit", "timeout", "network", "provider_response", "unknown"]);
    const kind = allowedKinds.has(result.assistantError.kind) ? result.assistantError.kind : "unknown";
    const status = Number.isInteger(result.assistantError.status) ? result.assistantError.status : "none";
    console.error(`Provider reply failed: kind=${kind}; status=${status}`);
  }
  assert(result && !result.assistantError && result.assistantMessage?.content?.trim());
  assert(result.completion && result.completion.provider !== "mock" && result.completion.model !== "mock-local");
  assert.equal(result.assistantMessage.metadata?.status, "sent");
  console.log(`ok - actual saved vault credentials produce a non-mock reply${modelOverride ? " (temporary model override)" : ""}`);

  step = "independent database message and usage read";
  const stored = await reader.message.findMany({ where: { conversationId: companion.conversationId } });
  assert(stored.some((message) => message.id === result.userMessage.id));
  assert(stored.some((message) => message.id === result.assistantMessage.id && message.content === result.assistantMessage.content));
  assert(await reader.modelUsageLog.count({ where: { conversationId: companion.conversationId, purpose: "chat_reply", status: "success" } }));
  console.log("ok - independent database client reads both messages and successful usage log");

  step = "real personalized proactive delivery";
  const state = result.relationshipState;
  const plan = createProactiveDraftPlan({
    companion, state: { ...state, importantEvents: [] },
    lastUserMessage: "今天想和你说说话。", proactiveMessagesEnabled: true,
    frequencyPreset: "1m", frequencyMinutes: 1,
    now: new Date(new Date(state.lastInteractionAt).getTime() + 70_000), force: false
  });
  assert(plan.drafts.length);
  const { createUserLlmProvider } = load(resolve(root, "src/lib/llm/user-provider.ts"));
  const provider = await createUserLlmProvider(user.id);
  const diagnosticProvider = { name: provider.name, async complete(options) {
    try { return await provider.complete({ ...options, ...(modelOverride ? { model: modelOverride } : {}) }); }
    catch (error) {
      const status = Number.isInteger(error?.details?.status) ? error.details.status : "none";
      const raw = typeof error?.details?.cause === "string" ? error.details.cause : "";
      const parameterHints = ["temperature", "max_tokens", "max_completion_tokens", "unsupported_parameter", "unsupported_value", "quota", "context_length"]
        .filter((hint) => raw.includes(hint));
      console.error(JSON.stringify({ proactiveStatus: status, parameterHints }));
      throw error;
    }
  } };
  const generated = await personalizeProactiveDraft(companion, plan.drafts[0], stored.map((message) => ({
    ...message, role: message.role.toLowerCase(), createdAt: message.createdAt.toISOString()
  })), diagnosticProvider);
  step = `personalized proactive output: ${generated.source}`;
  assert.equal(generated.source, "model");
  step = "persist generated proactive message";
  const draft = generated.draft;
  const saved = await repository.createProactiveMessage(user.id, companion.id, {
    kind: draft.kind, content: draft.content, reason: draft.reason,
    safety: { result: draft.safety, generator: generated.source }, status: "draft", scheduledAt: draft.scheduledAt,
    deliveryKey: `qa-${companion.id}`
  });
  assert(saved);
  step = "automatic proactive delivery respects saved opt-outs";
  const preferences = await reader.user.findUnique({ where: { id: user.id }, select: { proactiveMessagesEnabled: true } });
  const delivered = await repository.deliverProactiveMessage(user.id, saved.id, { automatic: true });
  if (!preferences.proactiveMessagesEnabled) {
    assert.equal(delivered, null);
    console.log("ok - automatic delivery honors the user's disabled global proactive setting");
  }
  const sent = delivered ?? await repository.deliverProactiveMessage(user.id, saved.id);
  step = "persisted proactive message and duplicate delivery";
  assert(sent && sent.message.role === "assistant");
  const repeated = await repository.deliverProactiveMessage(user.id, saved.id);
  assert.equal(repeated?.message.id, sent.message.id);
  step = "independent proactive status and linked message read";
  assert.equal((await reader.proactiveMessage.findUnique({ where: { id: saved.id } }))?.status, "SENT");
  assert.equal(await reader.message.count({ where: { proactiveMessageId: saved.id } }), 1);
  assert.equal((await reader.message.findUnique({ where: { id: sent.message.id } }))?.content, draft.content);
  step = "proactive model usage log";
  assert(await reader.modelUsageLog.count({ where: { companionId: companion.id, purpose: "proactive_draft", status: "success" } }));
  step = "saved model selection remains unchanged";
  assert.equal((await reader.providerCredential.findUnique({ where: { userId_kind: { userId: user.id, kind: "llm" } }, select: { model: true } }))?.model, credential.model);
  console.log("ok - real personalized proactive message is delivered once and independently persisted");
  }
} catch (error) {
  const code = /^[A-Z]\d{4}$/.test(error?.code || "") ? error.code : "none";
  console.error(`Saved-vault provider QA failed during: ${step}; code=${code}`);
  process.exitCode = 1;
} finally {
  if (companionId) {
    try {
      assert.equal(await service.deleteCompanion(companionId), true);
      console.log("ok - temporary QA companion and its conversation data removed");
    } catch {
      console.error("Saved-vault provider QA cleanup requires attention.");
      process.exitCode = 1;
    }
  }
  await reader.$disconnect();
  await prisma.$disconnect();
}
