import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import * as ts from "typescript";
import { loadLocalEnv } from "../scripts/load-local-env.mjs";
import { migrationDatabaseUrl } from "../scripts/database-url.mjs";

if (process.env.AUTH_DATABASE_QA !== "1") {
  console.log("Isolated PostgreSQL QA skipped: set AUTH_DATABASE_QA=1 to opt in.");
  process.exit(0);
}
loadLocalEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const schema = `renewal_qa_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^renewal_qa_[a-f0-9]{32}$/);
const url = new URL(migrationDatabaseUrl());
const bootstrap = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
url.searchParams.set("schema", schema);
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
const mails = [];
const cookies = new Map();
const mailServer = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  mails.push(JSON.parse(Buffer.concat(chunks).toString()));
  response.writeHead(202).end();
});
let created = false;
let step = "create isolated schema";
try {
  await bootstrap.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  step = "apply versioned migrations in isolated schema";
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    cwd: root, encoding: "utf8", windowsHide: true,
    env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 120_000
  });
  if (migration.status !== 0) {
    const code = `${migration.stdout || ""}\n${migration.stderr || ""}`.match(/\bP\d{4}\b/)?.[0] || "unknown";
    console.error(`Isolated migration error: code=${code}; signal=${migration.signal || "none"}`);
  }
  assert.equal(migration.status, 0, "Isolated migration failed.");
  console.log("ok - versioned migrations apply in isolated schema");
  await new Promise((resolve) => mailServer.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    NODE_ENV: "test", AUTH_MODE: "password", AUTH_MAIL_TRANSPORT: "http",
    AUTH_APP_URL: "http://localhost:3000", AUTH_MAIL_FROM: "sender@example.invalid",
    AUTH_MAIL_API_URL: `http://127.0.0.1:${mailServer.address().port}/send`,
    AUTH_MAIL_API_KEY: "placeholder-mail-key", SESSION_COOKIE_SECRET: "auth-postgres-test-session-secret-32"
  });
  const modules = new Map();
  function load(path) {
    if (!existsSync(path) && path.endsWith(".ts")) {
      path = resolve(path.slice(0, -3), "index.ts");
    }
    if (modules.has(path)) return modules.get(path).exports;
    const loaded = { exports: {} };
    modules.set(path, loaded);
    const source = readFileSync(path, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    const scopedRequire = (id) => {
      if (id === "@/lib/prisma") return { prisma };
      if (id === "next/headers") return { cookies: async () => ({
        get: (key) => cookies.has(key) ? { value: cookies.get(key) } : undefined,
        set: (key, value) => cookies.set(key, value)
      }) };
      if (id === "@/lib/users/profile") return { upsertFallbackProfile: () => {} };
      if (id.startsWith("@/")) return load(resolve(root, "src", `${id.slice(2)}.ts`));
      if (id.startsWith(".")) return load(resolve(dirname(path), `${id}.ts`));
      return require(id);
    };
    new Function("require", "module", "exports", output)(scopedRequire, loaded, loaded.exports);
    return loaded.exports;
  }
  const auth = load(resolve(root, "src/lib/auth/service.ts"));
  const sessions = load(resolve(root, "src/lib/auth/session.ts"));
  const password = "test-password-for-auth-qa";
  const email = "registered@example.invalid";
  const readToken = () => new URLSearchParams(new URL(mails.at(-1).text.match(/http[^\s]+/)[0]).hash.slice(1)).get("token");

  step = "verified registration and concurrent token consumption";
  await auth.registerWithPassword({ email, password, nickname: "Password QA" });
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  const token = readToken();
  const replay = await Promise.allSettled([auth.verifyRegistration(token), auth.verifyRegistration(token)]);
  assert.equal(replay.filter((result) => result.status === "fulfilled").length, 1);
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { authCredential: true } });
  assert.ok(user.authCredential.passwordHash.startsWith("scrypt-v1$"));
  assert.ok(!JSON.stringify(user).includes(password));
  await assert.rejects(auth.authenticatePassword(email, "wrong-password"));
  const identity = await auth.authenticatePassword(email, password);
  await sessions.createPasswordSession(identity);
  assert.equal((await sessions.getOptionalSession()).userId, user.id);
  console.log("ok - verified registration, salted password login, single-use token and v2 session");

  step = "password reset revokes sessions";
  await auth.forgotPassword(email);
  const reset = readToken();
  await auth.resetPassword(reset, "replacement-password-for-qa");
  assert.equal(await sessions.getOptionalSession(), null);
  await assert.rejects(auth.authenticatePassword(email, password));
  await auth.authenticatePassword(email, "replacement-password-for-qa");
  await assert.rejects(auth.resetPassword(reset, password));
  console.log("ok - reset revokes sessions and rejects replay and old password");

  step = "legacy account ownership and expiry";
  const legacy = await prisma.user.create({ data: { email: "legacy@example.invalid", nickname: "Legacy" } });
  await auth.registerWithPassword({ email: legacy.email, password });
  assert.equal(await prisma.authCredential.count({ where: { userId: legacy.id } }), 0);
  await auth.forgotPassword(legacy.email);
  const legacyToken = readToken();
  await prisma.authRecoveryToken.updateMany({ where: { userId: legacy.id }, data: { expiresAt: new Date(0) } });
  await assert.rejects(auth.resetPassword(legacyToken, password));
  await auth.forgotPassword(legacy.email);
  await auth.resetPassword(readToken(), password);
  await auth.authenticatePassword(legacy.email, password);
  console.log("ok - existing accounts require mailbox proof; expired recovery tokens fail");

  step = "persistent limits and checkpoint compare-and-set";
  const limits = await Promise.allSettled(Array.from({ length: 11 }, () => auth.enforceAuthRateLimit("isolated", "identity")));
  assert.equal(limits.filter((result) => result.status === "fulfilled").length, 10);
  const { PrismaRenewalRepository } = load(resolve(root, "src/lib/renewal/prisma-repository.ts"));
  const repository = new PrismaRenewalRepository();
  await repository.setProactiveSchedulerCheckpoint("all", "first", null);
  await repository.setProactiveSchedulerCheckpoint("all", "second", "first");
  await repository.setProactiveSchedulerCheckpoint("all", "stale", "first");
  assert.equal(await repository.getProactiveSchedulerCheckpoint("all"), "second");
  await repository.setProactiveSchedulerCheckpoint("all", null, "second");
  assert.equal(await repository.getProactiveSchedulerCheckpoint("all"), null);
  await prisma.user.delete({ where: { id: legacy.id } });
  assert.equal(await prisma.authCredential.count({ where: { userId: legacy.id } }), 0);
  console.log("ok - real database rate limits, checkpoint compare-and-set and credential cascade");

  step = "proactive delivery: isolated fixtures and concurrent keyed creation";
  const otherUser = await prisma.user.create({
    data: { email: "proactive-other@example.invalid", nickname: "Other delivery QA" }
  });
  const companionInput = { name: "Delivery QA", relationshipKind: "FRIEND", speakingStyle: "gentle" };
  const companion = await repository.createCompanion(user.id, companionInput);
  const sibling = await repository.createCompanion(user.id, companionInput);
  const foreign = await repository.createCompanion(otherUser.id, companionInput);
  const draftInput = (deliveryKey, extra = {}) => ({
    kind: "DAILY_GREETING", content: "Isolated proactive hello", reason: "delivery QA",
    deliveryKey, ...extra
  });
  const keyed = await Promise.all(Array.from({ length: 4 }, () =>
    new PrismaRenewalRepository().createProactiveMessage(user.id, companion.id, draftInput("concurrent-delivery"))
  ));
  assert.equal(new Set(keyed.map((record) => record.id)).size, 1);
  const proactive = keyed[0];
  assert.equal(proactive.deliveryKey, "concurrent-delivery");
  assert.equal(await prisma.proactiveMessage.count({ where: { deliveryKey: proactive.deliveryKey } }), 1);
  assert.deepEqual(
    await repository.createProactiveMessage(user.id, companion.id, draftInput(proactive.deliveryKey, {
      content: "must not overwrite draft", reason: "different reason", status: "blocked"
    })), proactive
  );
  console.log("ok - concurrent deliveryKey creation returns one unchanged owned draft");

  step = "proactive delivery: concurrent automatic and manual sends";
  assert.equal(await prisma.message.count({ where: { proactiveMessageId: proactive.id } }), 0);
  const deliveries = await Promise.all(Array.from({ length: 4 }, (_, index) => index % 2
    ? new PrismaRenewalRepository().updateProactiveMessage(user.id, proactive.id, { status: "sent" })
    : new PrismaRenewalRepository().deliverProactiveMessage(user.id, proactive.id, { automatic: true })
  ));
  assert.ok(deliveries.every(Boolean));
  assert.ok(deliveries.every((result) => (result.proactiveMessage ?? result).status === "sent"));
  const delivered = await repository.deliverProactiveMessage(user.id, proactive.id);
  const assistant = await prisma.message.findUniqueOrThrow({ where: { proactiveMessageId: proactive.id } });
  assert.equal(delivered.message.id, assistant.id);
  assert.equal(assistant.role, "ASSISTANT");
  assert.equal(assistant.content, proactive.content);
  assert.equal(assistant.conversationId, companion.conversationId);
  assert.equal(await prisma.message.count({ where: { proactiveMessageId: proactive.id } }), 1);
  assert.equal(await prisma.message.count({ where: { conversationId: companion.conversationId } }), 1);
  for (const result of deliveries.filter((result) => result.message)) assert.equal(result.message.id, assistant.id);
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: companion.conversationId } });
  assert.equal(conversation.lastMessageAt.toISOString(), assistant.createdAt.toISOString());
  const sentSnapshot = await prisma.proactiveMessage.findUniqueOrThrow({ where: { id: proactive.id } });
  const sentRetry = await repository.createProactiveMessage(user.id, companion.id, draftInput(proactive.deliveryKey, {
    content: "must not overwrite sent", status: "draft"
  }));
  assert.equal(sentRetry.status, "sent");
  assert.deepEqual(await prisma.proactiveMessage.findUniqueOrThrow({ where: { id: proactive.id } }), sentSnapshot);
  console.log("ok - concurrent automatic/manual sends insert exactly one linked assistant and advance lastMessageAt");

  step = "proactive delivery: restore draft and resend";
  await repository.updateProactiveMessage(user.id, proactive.id, { status: "draft", content: "restored draft edit" });
  const restored = await Promise.all([
    repository.deliverProactiveMessage(user.id, proactive.id, { automatic: true }),
    new PrismaRenewalRepository().deliverProactiveMessage(user.id, proactive.id)
  ]);
  assert.ok(restored.every((result) => result?.message.id === assistant.id && result.proactiveMessage.status === "sent"));
  assert.equal(await prisma.message.count({ where: { proactiveMessageId: proactive.id } }), 1);
  assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: assistant.id } })).content, proactive.content);
  assert.equal(
    (await prisma.conversation.findUniqueOrThrow({ where: { id: companion.conversationId } })).lastMessageAt.toISOString(),
    assistant.createdAt.toISOString()
  );
  console.log("ok - restoring and concurrently resending a draft reuses its original assistant message");

  step = "proactive delivery: blocked/dismissed status preservation and denial";
  for (const status of ["blocked", "dismissed"]) {
    const denied = await repository.createProactiveMessage(user.id, companion.id, draftInput(`denied-${status}`, { status }));
    const before = await prisma.proactiveMessage.findUniqueOrThrow({ where: { id: denied.id } });
    assert.deepEqual(
      await repository.createProactiveMessage(user.id, companion.id, draftInput(denied.deliveryKey, { content: "overwrite", status: "draft" })),
      denied
    );
    assert.equal(await repository.deliverProactiveMessage(user.id, denied.id, { automatic: true }), null);
    assert.equal(await repository.updateProactiveMessage(user.id, denied.id, { status: "sent", content: "unsafe edit" }), null);
    assert.equal(await prisma.message.count({ where: { proactiveMessageId: denied.id } }), 0);
    assert.deepEqual(await prisma.proactiveMessage.findUniqueOrThrow({ where: { id: denied.id } }), before);
  }
  console.log("ok - duplicate creation preserves blocked/dismissed records; delivery and manual sent are denied");

  step = "proactive delivery: cross-user and cross-companion isolation";
  const owned = await repository.createProactiveMessage(user.id, companion.id, draftInput("ownership"));
  const ownedBefore = await prisma.proactiveMessage.findUniqueOrThrow({ where: { id: owned.id } });
  assert.equal(await repository.deliverProactiveMessage(otherUser.id, owned.id), null);
  assert.equal(await repository.deliverProactiveMessage(otherUser.id, owned.id, { automatic: true }), null);
  assert.equal(await repository.updateProactiveMessage(otherUser.id, owned.id, { status: "sent" }), null);
  await assert.rejects(repository.createProactiveMessage(otherUser.id, companion.id, draftInput("wrong-owner")));
  await assert.rejects(repository.createProactiveMessage(otherUser.id, foreign.id, draftInput(owned.deliveryKey)));
  await assert.rejects(repository.createProactiveMessage(user.id, sibling.id, draftInput(owned.deliveryKey)));
  assert.deepEqual(await prisma.proactiveMessage.findUniqueOrThrow({ where: { id: owned.id } }), ownedBefore);
  assert.equal(await prisma.message.count({ where: { proactiveMessageId: owned.id } }), 0);
  assert.equal(await prisma.message.count({ where: { conversationId: foreign.conversationId } }), 0);
  console.log("ok - delivery and deliveryKey collisions cannot cross user or companion ownership");

  step = "proactive delivery: transaction-time user and companion opt-outs";
  for (const target of ["user", "companion"]) {
    const optedOut = await repository.createProactiveMessage(user.id, companion.id, draftInput(`optout-${target}`));
    const before = await prisma.proactiveMessage.findUniqueOrThrow({ where: { id: optedOut.id } });
    const lastMessageAt = (await prisma.conversation.findUniqueOrThrow({ where: { id: companion.conversationId } })).lastMessageAt;
    // Toggle after draft creation, reproducing an opt-out during a slow model call.
    if (target === "user") await prisma.user.update({ where: { id: user.id }, data: { proactiveMessagesEnabled: false } });
    else await prisma.companion.update({ where: { id: companion.id }, data: { proactiveMessagesEnabled: false } });
    assert.equal(await repository.deliverProactiveMessage(user.id, optedOut.id, { automatic: true }), null);
    assert.equal(await prisma.message.count({ where: { proactiveMessageId: optedOut.id } }), 0);
    assert.deepEqual(await prisma.proactiveMessage.findUniqueOrThrow({ where: { id: optedOut.id } }), before);
    assert.deepEqual((await prisma.conversation.findUniqueOrThrow({ where: { id: companion.conversationId } })).lastMessageAt, lastMessageAt);
    const manual = await repository.updateProactiveMessage(user.id, optedOut.id, { status: "sent" });
    assert.equal(manual.status, "sent", "explicit sends remain available while automatic delivery is disabled");
    assert.equal(await prisma.message.count({ where: { proactiveMessageId: optedOut.id } }), 1);
    if (target === "user") await prisma.user.update({ where: { id: user.id }, data: { proactiveMessagesEnabled: true } });
    else await prisma.companion.update({ where: { id: companion.id }, data: { proactiveMessagesEnabled: true } });
  }
  console.log("ok - automatic delivery rechecks each opt-out after drafting; explicit manual sends still work");

  step = "proactive delivery: migrated nullable uniqueness and delete relations";
  const unkeyed = await Promise.all([null, undefined].map((key) =>
    repository.createProactiveMessage(user.id, companion.id, draftInput(key))
  ));
  assert.notEqual(unkeyed[0].id, unkeyed[1].id);
  assert.ok(unkeyed.every((record) => record.deliveryKey === null));
  await assert.rejects(prisma.message.create({ data: {
    conversationId: companion.conversationId, proactiveMessageId: proactive.id,
    role: "ASSISTANT", content: "duplicate must fail"
  } }), (error) => error.code === "P2002");
  assert.equal(await prisma.message.count({ where: { proactiveMessageId: proactive.id } }), 1);
  const toDelete = await repository.createProactiveMessage(user.id, sibling.id, draftInput("delete-proactive"));
  const detached = await repository.deliverProactiveMessage(user.id, toDelete.id);
  await prisma.proactiveMessage.delete({ where: { id: toDelete.id } });
  assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: detached.message.id } })).proactiveMessageId, null);
  const cascadeDraft = await repository.createProactiveMessage(user.id, sibling.id, draftInput("delete-companion"));
  const cascadeDelivery = await repository.deliverProactiveMessage(user.id, cascadeDraft.id);
  assert.equal(await repository.deleteCompanion(user.id, sibling.id), true);
  assert.equal(await prisma.proactiveMessage.count({ where: { id: cascadeDraft.id } }), 0);
  assert.equal(await prisma.message.count({ where: { id: { in: [detached.message.id, cascadeDelivery.message.id] } } }), 0);
  assert.equal(await prisma.conversation.count({ where: { id: sibling.conversationId } }), 0);
  console.log("ok - migrated unique links reject duplicates; nullable keys, SetNull and companion cascades work");
} catch (error) {
  const code = error?.code || error?.errorCode || "none";
  const reason = /can't reach database server/i.test(error?.message || "") ? "database_unreachable" : "check_failed";
  console.error(`Isolated PostgreSQL QA failed during: ${step}; type=${error?.name || "Error"}; code=${code}; databaseCode=${error?.meta?.code || "none"}; reason=${reason}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  if (mailServer.listening) await new Promise((resolve) => mailServer.close(resolve));
  if (created) {
    await bootstrap.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    console.log("ok - isolated QA schema removed");
  }
  await bootstrap.$disconnect();
}
