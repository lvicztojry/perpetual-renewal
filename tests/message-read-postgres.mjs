import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// No env files, database clients, migrations or connections before explicit opt-in.
if (process.env.MESSAGE_SYNC_DATABASE_QA !== "1") {
  console.log("Message sync PostgreSQL QA skipped; opt in with MESSAGE_SYNC_DATABASE_QA=1.");
} else {
  await run().catch(error => {
    console.error(`Message sync PostgreSQL QA failed during setup/cleanup; ${codes(error)}.`);
    process.exitCode = 1;
  });
}

function codes(error) {
  const safe = value => typeof value === "string" && /^[A-Z0-9_]{1,16}$/.test(value) ? value : "none";
  return `code=${safe(error?.code)}; sqlstate=${safe(error?.meta?.code)}`;
}

async function run() {
  // The caller must inject configuration. Never load .env or application stores.
  const { migrationDatabaseUrl } = await import("../scripts/database-url.mjs");
  const configured = migrationDatabaseUrl();
  if (!configured) throw new Error("Injected database configuration is required.");
  const { PrismaClient, Prisma } = await import("@prisma/client");
  const { default: ts } = await import("typescript");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = resolve(root, "src/lib/sync") + sep;
  const schema = `renewal_message_sync_qa_${randomUUID().replaceAll("-", "")}`;
  const ownSchema = () => assert.match(schema, /^renewal_message_sync_qa_[a-f0-9]{32}$/);
  ownSchema();
  const url = new URL(configured);
  url.searchParams.set("schema", schema);
  const isolatedUrl = url.toString();
  const bootstrap = new PrismaClient({ datasources: { db: { url: isolatedUrl } }, log: [] });
  // Every fixture identifier is qualified, including the enum cast. Migrations
  // run separately against isolatedUrl; fixtures never rely on raw search_path.
  const tables = Object.fromEntries(["User", "Companion", "Conversation", "Message", "GroupWorkspace", "MessageReadReceipt", "MessageRole"]
    .map(name => [name, Prisma.raw(`"${schema}"."${name}"`)]));
  const client = () => {
    assert.equal(new URL(isolatedUrl).searchParams.get("schema"), schema);
    return new PrismaClient({ datasources: { db: { url: isolatedUrl } }, log: [] });
  };
  const require = createRequire(import.meta.url), cache = new Map();
  function load(filename) {
    assert.ok(filename.startsWith(source) && existsSync(filename));
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiledModule = { exports: {} }; cache.set(filename, compiledModule);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("exports", "require", "module", output)(compiledModule.exports, name => {
      if (name.startsWith(".")) return load(resolve(dirname(filename), name + ".ts"));
      assert.equal(name, "@prisma/client"); return require(name);
    }, compiledModule);
    return compiledModule.exports;
  }
  let db, peer, created = false, failed = false;
  async function check(label, runCheck) {
    try { await runCheck(); console.log(`ok - ${label}`); }
    catch (error) {
      // Do not print assertions, driver messages, SQL, URLs or arbitrary meta.
      failed = true; console.error(`FAIL - ${label}; ${codes(error)}.`);
    }
  }
  try {
    ownSchema(); await bootstrap.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    db = client(); peer = client();
    ownSchema();
    assert.equal(new URL(isolatedUrl).searchParams.get("schema"), schema);
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      cwd: root, windowsHide: true, encoding: "utf8", timeout: 120000,
      env: { ...process.env, DATABASE_URL: isolatedUrl, DATABASE_URL_UNPOOLED: isolatedUrl, DIRECT_URL: isolatedUrl }
    });
    if (migration.status !== 0 || migration.error) {
      // Child output can contain credentials or SQL: expose error codes only.
      const found = [...new Set(`${migration.stdout ?? ""}\n${migration.stderr ?? ""}`.match(/\bP\d{4}\b/g) ?? [])];
      console.error(`Isolated migration failed; codes=${found.join(",") || "none"}; ${codes(migration.error)}.`);
      throw new Error("Isolated migration failed.");
    }
    for (const connection of [db, peer]) {
      const [row] = await connection.$queryRaw`SELECT pg_catalog.to_regclass(${`"${schema}"."MessageReadReceipt"`})::text AS relation`;
      assert.equal(row.relation, `${schema}."MessageReadReceipt"`);
    }
    assert.equal((await db.$queryRaw`SELECT COUNT(*) AS count FROM ${tables.MessageReadReceipt}`)[0].count, 0n);
    console.log("ok - project migrations deployed; both clients explicitly address only the temporary schema");
    const { PrismaReadReceiptRepository } = load(resolve(root, "src/lib/sync/read-receipts-prisma.ts"));
    const api = new PrismaReadReceiptRepository(db, schema), otherApi = new PrismaReadReceiptRepository(peer, schema);
    const stamp = new Date("2026-11-17T02:00:00.123Z");
    const user = async () => {
      const id = randomUUID();
      await db.$executeRaw`INSERT INTO ${tables.User} ("id", "email", "nickname", "updatedAt") VALUES (${id}, ${`${id}@example.invalid`}, 'message sync fixture', now())`;
      return id;
    };
    const owner = await user(), foreign = await user();
    const scene = async userId => {
      const companionId = randomUUID(), conversationId = randomUUID(), groupId = randomUUID();
      await db.$executeRaw`INSERT INTO ${tables.Companion} ("id", "userId", "name", "relationshipKind", "speakingStyle", "personality", "updatedAt")
        VALUES (${companionId}, ${userId}, 'QA companion', 'FRIEND', 'natural', ARRAY[]::text[], now())`;
      await db.$executeRaw`INSERT INTO ${tables.Conversation} ("id", "userId", "companionId", "updatedAt") VALUES (${conversationId}, ${userId}, ${companionId}, now())`;
      const state = { id: groupId, userId, messages: [] };
      await db.$executeRaw`INSERT INTO ${tables.GroupWorkspace} ("id", "userId", "revision", "state", "updatedAt") VALUES (${groupId}, ${userId}, 0, ${JSON.stringify(state)}::jsonb, now())`;
      const add = async (scope, extra = {}, createdAt = stamp) => {
        const id = randomUUID();
        if (scope === "private") {
          await db.$executeRaw`INSERT INTO ${tables.Message} ("id", "conversationId", "role", "content", "metadata", "createdAt")
            VALUES (${id}, ${conversationId}, ${extra.role ?? "ASSISTANT"}::${tables.MessageRole}, 'synthetic QA message', ${JSON.stringify(extra.metadata ?? null)}::jsonb, ${createdAt})`;
        } else {
          const message = { id, speakerId: companionId, content: 'synthetic QA message', createdAt: createdAt.toISOString(), ...extra };
          await db.$executeRaw`UPDATE ${tables.GroupWorkspace} SET "state" = jsonb_set("state", '{messages}', ("state"->'messages') || ${JSON.stringify([message])}::jsonb), "revision" = "revision" + 1, "updatedAt" = now() WHERE "id" = ${groupId}`;
        }
        return id;
      };
      const thread = scope => scope === "private" ? conversationId : groupId;
      const mark = (connection, scope, ids) => connection.mark(userId, { scope, threadId: thread(scope), messageIds: ids });
      const unread = async (connection, scope) => (await connection.inbox(userId)).find(t => t.scope === scope && t.threadId === thread(scope))?.unreadCount;
      const receiptCount = async scope => Number((await db.$queryRaw`SELECT COUNT(*) AS count FROM ${tables.MessageReadReceipt} WHERE "userId" = ${userId} AND "scope" = ${scope} AND "threadId" = ${thread(scope)}`)[0].count);
      return { userId, companionId, conversationId, groupId, add, thread, mark, unread, receiptCount };
    };

    await check("private/group inbox, two-client interleaving, explicit IDs and same-millisecond arrivals", async () => {
      const s = await scene(owner);
      for (const scope of ["private", "group"]) {
        const a = await s.add(scope), b = await s.add(scope);
        await s.add(scope, scope === "private" ? { role: "USER" } : { speakerId: null });
        if (scope === "private") await s.add(scope, { role: "SYSTEM" });
        assert.equal(await s.unread(api, scope), 2);
        assert.equal(await s.mark(otherApi, scope, [b, b]), 1);
        const late = await s.add(scope), backdated = await s.add(scope, {}, new Date("1900-01-01T00:00:00Z"));
        assert.equal(await s.mark(api, scope, [a]), 1);
        assert.equal(await s.mark(otherApi, scope, [a, b]), 0);
        assert.equal(await s.unread(api, scope), 2);
        assert.equal(await s.mark(api, scope, [late]), 1);
        assert.equal(await s.unread(otherApi, scope), 1);
        assert.equal(await s.mark(otherApi, scope, [backdated]), 1);
        assert.equal(await s.unread(api, scope), 0);
      }
      const threads = await api.inbox(owner);
      assert.ok(threads.every(t => Object.keys(t).sort().join(",") === "scope,threadId,unreadCount"));
    });

    await check("foreign/cross-thread/hidden IDs reject the whole batch in both scopes", async () => {
      const s = await scene(owner), stranger = await scene(foreign), sibling = await scene(owner);
      const flags = [{ deleted: true }, { deletedAt: stamp.toISOString() }, { hidden: true }, { hiddenAt: stamp.toISOString() }, { status: "failed" }, { status: "deleted" }, { status: "hidden" }];
      for (const scope of ["private", "group"]) {
        const valid = await s.add(scope), foreignId = await stranger.add(scope), siblingId = await sibling.add(scope);
        const invalidIds = [foreignId, siblingId, randomUUID(), await s.add(scope, scope === "private" ? { role: "USER" } : { speakerId: null })];
        for (const metadata of flags) {
          invalidIds.push(await s.add(scope, { metadata }));
          if (scope === "group") invalidIds.push(await s.add(scope, metadata));
        }
        for (const invalid of invalidIds) {
          await assert.rejects(s.mark(api, scope, [valid, invalid]), e => e.status === 404);
          assert.equal(await s.receiptCount(scope), 0);
          assert.equal(await s.unread(otherApi, scope), 1);
        }
        await assert.rejects(api.mark(foreign, { scope, threadId: s.thread(scope), messageIds: [valid] }), e => e.status === 404);
        await assert.rejects(api.mark(owner, { scope, threadId: stranger.thread(scope), messageIds: [foreignId] }), e => e.status === 404);
        assert.equal((await api.inbox(foreign)).some(t => t.threadId === s.thread(scope)), false);
        for (const deleted of [false, null, 0, ""]) {
          const id = await s.add(scope, scope === "private" ? { metadata: { deleted } } : { deleted, metadata: { deleted } });
          assert.equal(await s.mark(otherApi, scope, [id]), 1);
        }
        assert.equal(await s.unread(api, scope), 1);
      }
    });

    await check("soft deletion/hiding and group snapshot removal preserve other unread IDs", async () => {
      const s = await scene(owner);
      for (const scope of ["private", "group"]) {
        const hidden = await s.add(scope), untouched = await s.add(scope);
        if (scope === "private") {
          await peer.$executeRaw`UPDATE ${tables.Message} SET "metadata" = '{"deleted":true}'::jsonb WHERE "id" = ${hidden}`;
        } else {
          await peer.$executeRaw`UPDATE ${tables.GroupWorkspace} SET "state" = jsonb_set("state", '{messages,0,deleted}', 'true'::jsonb), "revision" = "revision" + 1 WHERE "id" = ${s.groupId}`;
        }
        assert.equal(await s.unread(api, scope), 1);
        await assert.rejects(s.mark(api, scope, [untouched, hidden]), e => e.status === 404);
        assert.equal(await s.receiptCount(scope), 0);
        if (scope === "private") await peer.$executeRaw`DELETE FROM ${tables.Message} WHERE "id" = ${hidden}`;
        else await peer.$executeRaw`UPDATE ${tables.GroupWorkspace} SET "state" = jsonb_set("state", '{messages}', ("state"->'messages') - 0), "revision" = "revision" + 1 WHERE "id" = ${s.groupId}`;
        await assert.rejects(s.mark(api, scope, [untouched, hidden]), e => e.status === 404);
        assert.equal(await s.unread(otherApi, scope), 1);
      }
    });

    for (const scope of ["private", "group"]) {
      await check(`${scope}: two independent connections concurrently acknowledge the same IDs exactly once`, async () => {
        const s = await scene(owner), id = await s.add(scope), waiters = [], observed = new Set();
        const rendezvous = () => new Promise((resolveGate, rejectGate) => {
          const timer = setTimeout(() => rejectGate(new Error("QA rendezvous timed out.")), 12000);
          waiters.push(() => { clearTimeout(timer); resolveGate(); });
          if (waiters.length === 2) waiters.forEach(release => release());
        });
        // Both Serializable snapshots validate before either INSERT. Only the
        // first attempt waits; an adapter retry must run a fresh whole transaction.
        const synchronized = connection => {
          let met = false;
          return new PrismaReadReceiptRepository({ $transaction: (runTransaction, options) => connection.$transaction(tx => runTransaction({ $queryRaw: async query => {
            if (!met && query.text.includes(`INSERT INTO "${schema}"."MessageReadReceipt"`)) { met = true; await rendezvous(); }
            try { return await tx.$queryRaw(query); }
            catch (error) { observed.add(codes(error)); throw error; }
          } }), options) }, schema);
        };
        const results = await Promise.allSettled([s.mark(synchronized(db), scope, [id, id]), s.mark(synchronized(peer), scope, [id])]);
        for (const code of observed) console.log(`info - ${scope} concurrent transaction observed ${code}.`);
        // Report actual Prisma and PostgreSQL codes, never raw error messages.
        for (const result of results) if (result.status === "rejected") throw result.reason;
        assert.deepEqual(results.map(r => r.value).sort(), [0, 1]);
        assert.ok([...observed].some(code => code.includes("sqlstate=40001")), "must exercise actual raw SQL serialization retry");
        assert.equal(await s.receiptCount(scope), 1);
        assert.equal(await s.unread(api, scope), 0);
        assert.equal(await s.mark(otherApi, scope, [id]), 0);
      });
    }

    await check("receipt export contains only currently owned visible IDs and excludes deleted snapshot orphans", async () => {
      const s = await scene(await user());
      const privateKeep = await s.add("private"), privateHidden = await s.add("private"), privateGone = await s.add("private");
      const groupKeep = await s.add("group"), groupHidden = await s.add("group"), groupMetaHidden = await s.add("group"), groupGone = await s.add("group");
      await s.mark(api, "private", [privateKeep, privateHidden, privateGone]);
      await s.mark(otherApi, "group", [groupKeep, groupHidden, groupMetaHidden, groupGone]);
      assert.equal((await api.listForExport(s.userId)).length, 7);
      await db.$executeRaw`UPDATE ${tables.Message} SET "metadata" = '{"deleted":true}'::jsonb WHERE "id" = ${privateHidden}`;
      await db.$executeRaw`DELETE FROM ${tables.Message} WHERE "id" = ${privateGone}`;
      const [row] = await db.$queryRaw`SELECT "state"->'messages' AS messages FROM ${tables.GroupWorkspace} WHERE "id" = ${s.groupId}`;
      const messages = row.messages.filter(m => m.id !== groupGone).map(m => m.id === groupHidden ? { ...m, deleted: true } : m.id === groupMetaHidden ? { ...m, metadata: { deleted: true } } : m);
      await peer.$executeRaw`UPDATE ${tables.GroupWorkspace} SET "state" = jsonb_set("state", '{messages}', ${JSON.stringify(messages)}::jsonb), "revision" = "revision" + 1 WHERE "id" = ${s.groupId}`;
      const exported = await otherApi.listForExport(s.userId);
      assert.deepEqual(exported.map(r => r.messageId).sort(), [privateKeep, groupKeep].sort());
      assert.ok(exported.every(r => Object.keys(r).sort().join(",") === "messageId,scope,threadId"));
      assert.equal((await api.listForExport(foreign)).some(r => r.threadId === s.conversationId || r.threadId === s.groupId), false);
      await db.$executeRaw`DELETE FROM ${tables.Conversation} WHERE "id" = ${s.conversationId}`;
      await db.$executeRaw`DELETE FROM ${tables.GroupWorkspace} WHERE "id" = ${s.groupId}`;
      assert.deepEqual(await api.listForExport(s.userId), []);
    });

    await check("hard message/thread/companion/group/account deletion cascades only matching receipts", async () => {
      const s = await scene(await user()), survivor = await scene(foreign);
      const survivorPrivate = await survivor.add("private"), survivorGroup = await survivor.add("group");
      await survivor.mark(api, "private", [survivorPrivate]); await survivor.mark(api, "group", [survivorGroup]);
      const seen = await s.add("private"), unseen = await s.add("private");
      await s.mark(api, "private", [seen]);
      await peer.$executeRaw`DELETE FROM ${tables.Message} WHERE "id" = ${seen}`;
      assert.equal(await s.receiptCount("private"), 0); assert.equal(await s.unread(api, "private"), 1);
      await assert.rejects(s.mark(api, "private", [unseen, seen]), e => e.status === 404);
      assert.equal(await s.receiptCount("private"), 0);
      await s.mark(api, "private", [unseen]);
      await db.$executeRaw`DELETE FROM ${tables.Conversation} WHERE "id" = ${s.conversationId}`;
      assert.equal(await s.receiptCount("private"), 0); assert.equal(await s.unread(otherApi, "private"), undefined);
      const p = await scene(s.userId), pm = await p.add("private");
      await p.mark(api, "private", [pm]);
      await db.$executeRaw`DELETE FROM ${tables.Companion} WHERE "id" = ${p.companionId}`;
      assert.equal(await p.receiptCount("private"), 0); assert.equal(await p.unread(api, "private"), undefined);
      const gm = await s.add("group"); await s.mark(api, "group", [gm]);
      await db.$executeRaw`DELETE FROM ${tables.GroupWorkspace} WHERE "id" = ${s.groupId}`;
      assert.equal(await s.receiptCount("group"), 0); assert.equal(await s.unread(api, "group"), undefined);
      const account = await scene(s.userId);
      await account.mark(api, "private", [await account.add("private")]);
      await account.mark(api, "group", [await account.add("group")]);
      await db.$executeRaw`DELETE FROM ${tables.User} WHERE "id" = ${s.userId}`;
      assert.equal((await db.$queryRaw`SELECT COUNT(*) AS count FROM ${tables.MessageReadReceipt} WHERE "userId" = ${s.userId}`)[0].count, 0n);
      assert.deepEqual(await api.inbox(s.userId), []);
      assert.equal(await survivor.receiptCount("private"), 1); assert.equal(await survivor.receiptCount("group"), 1);
    });
  } finally {
    // Disconnect errors must not bypass schema cleanup. Never drop a supplied schema.
    const disconnected = await Promise.allSettled([db?.$disconnect(), peer?.$disconnect()]);
    if (disconnected.some(result => result.status === "rejected")) failed = true;
    try {
      if (created) { ownSchema(); await bootstrap.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); console.log("ok - own temporary schema removed"); }
    } finally { await bootstrap.$disconnect(); }
    if (failed) process.exitCode = 1;
  }
}
