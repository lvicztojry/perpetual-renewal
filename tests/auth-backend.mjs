import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import * as ts from "typescript";

// Hermetic behavioral checks use the same transpile/vm approach as the existing security checks.
// PostgreSQL serialization/DDL behavior is deliberately left to the separate DB integration run.
const nativeRequire = createRequire(import.meta.url);
const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const originalEnv = { ...process.env };
const cookieValues = new Map();
const cookieWrites = [];
const sent = [];
const cache = new Map();
let mailFails = false;
let dbFails = false;
let failCredentialWrite = false;
let transactionConflict = false;
let state = { users: [], credentials: [], tokens: [], rates: [] };
const cookieStore = {
  get(name) { return cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined; },
  set(name, value, options) {
    cookieWrites.push({ name, value, options });
    if (value) cookieValues.set(name, value); else cookieValues.delete(name);
  }
};

function matches(record, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("lte" in value) return record[key] <= value.lte;
      if ("gt" in value) return record[key] > value.gt;
    }
    return record[key] === value;
  });
}

function project(record, select) {
  if (!record) return null;
  const value = { ...record };
  if (select?.authCredential) value.authCredential = state.credentials.find((entry) => entry.userId === record.id) || null;
  if (!select) return value;
  return Object.fromEntries(Object.keys(select).map((key) => [key, value[key]]));
}

function delegate(table) {
  return {
    async findUnique({ where, select }) {
      if (dbFails) throw new Error("secret database URL password and token must never leak");
      return project(state[table].find((record) => matches(record, where)), select);
    },
    async create({ data, select }) {
      const record = { ...data };
      if (table === "users") {
        record.id ||= crypto.randomUUID();
        if (state.users.some((user) => user.email === record.email)) throw Object.assign(new Error(), { code: "P2002" });
        if (record.authCredential) {
          state.credentials.push({ userId: record.id, ...record.authCredential.create });
          delete record.authCredential;
        }
      }
      state[table].push(record);
      return project(record, select);
    },
    async upsert({ where, create, update, select }) {
      if (failCredentialWrite && table === "credentials") throw new Error("credential write unavailable");
      let record = state[table].find((entry) => matches(entry, where));
      if (!record) return this.create({ data: create, select });
      for (const [key, value] of Object.entries(update)) {
        record[key] = value && typeof value === "object" && "increment" in value ? record[key] + value.increment : value;
      }
      return project(record, select);
    },
    async deleteMany({ where } = {}) {
      const before = state[table].length;
      state[table] = state[table].filter((record) => !matches(record, where));
      return { count: before - state[table].length };
    }
  };
}

let transactionTail = Promise.resolve();
const prisma = {
  user: delegate("users"),
  authCredential: delegate("credentials"),
  authRecoveryToken: delegate("tokens"),
  authRateLimit: delegate("rates"),
  async $transaction(operation, options) {
    assert.equal(options.isolationLevel, "Serializable");
    if (transactionConflict) {
      transactionConflict = false;
      throw Object.assign(new Error(), { code: "P2034" });
    }
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((done) => { release = done; });
    await previous;
    const snapshot = structuredClone(state);
    try { return await operation(prisma); }
    catch (error) { state = snapshot; throw error; }
    finally { release(); }
  }
};

function load(path) {
  const filename = resolve(root, path);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const sandbox = {
    exports, Buffer, process, Date, URL, URLSearchParams, AbortSignal, Request, Response, Headers,
    fetch: async (url, options) => {
      assert.equal(String(url), "https://mail.example.test/send");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer " + "private-mail-api-key");
      assert(options.signal);
      if (mailFails) throw new Error("upstream private-mail-api-key token=private-reset-token");
      sent.push(JSON.parse(options.body));
      return new Response(null, { status: 202 });
    },
    require(specifier) {
      if (specifier === "next/headers") return { cookies: async () => cookieStore };
      if (specifier === "@/lib/prisma") return { prisma };
      if (specifier === "@/lib/renewal/types") return { DEMO_USER_ID: "demo-user" };
      if (specifier === "@/lib/users/profile") return {
        upsertFallbackProfile() {},
        getUserProfile: async (userId) => {
          const user = state.users.find((entry) => entry.id === userId);
          return user ? { id: user.id, email: user.email, nickname: user.nickname } : { id: userId };
        }
      };
      if (specifier === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      if (specifier.startsWith("@/")) return load(`src/${specifier.slice(2)}.ts`);
      if (specifier.startsWith(".")) return load(`${resolve(dirname(filename), specifier)}.ts`);
      return nativeRequire(specifier);
    }
  };
  const transpiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename
  });
  vm.createContext(sandbox);
  new vm.Script(transpiled.outputText, { filename }).runInContext(sandbox);
  return exports;
}

async function post(endpoint, body, headers = {}) {
  const route = load(`src/app/api/auth/${endpoint}/route.ts`);
  const response = await route.POST(new Request(`https://app.example.test/api/auth/${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body)
  }));
  assert.match(response.headers.get("cache-control"), /no-store/);
  const parsed = await response.json();
  const serialized = JSON.stringify(parsed);
  assert(!serialized.includes("passwordHash") && !serialized.includes("sessionVersion"));
  assert(!serialized.includes("private-mail-api-key") && !serialized.includes("tokenHash"));
  return { status: response.status, body: parsed };
}

function emailToken(index = sent.length - 1) {
  const link = sent[index].text.match(/https:\/\/[^\s]+/)[0];
  const url = new URL(link);
  assert.equal(url.search, "");
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert(!JSON.stringify(state).includes(token), "plaintext tokens must never be stored");
  return token;
}

function v1Cookie(userId) {
  const payload = Buffer.from(userId).toString("base64url");
  return `v1.${payload}.${crypto.createHmac("sha256", process.env.SESSION_COOKIE_SECRET).update(payload).digest("base64url")}`;
}

function expiredCookie(value) {
  const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url"));
  payload.expiresAt = Date.now() - 1000;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `v2.${encoded}.${crypto.createHmac("sha256", process.env.SESSION_COOKIE_SECRET).update(`v2.${encoded}`).digest("base64url")}`;
}

try {
  Object.assign(process.env, {
    NODE_ENV: "production", AUTH_MODE: "local-email", RENEWAL_REPOSITORY: "prisma",
    DATABASE_URL: "postgresql://user:password@localhost:5432/hermetic_never_connected",
    SESSION_COOKIE_SECRET: "auth-test-private-cookie-secret-at-least-32-bytes",
    AUTH_MAIL_TRANSPORT: "http", AUTH_MAIL_API_URL: "https://mail.example.test/send",
    AUTH_MAIL_API_KEY: "private-mail-api-key", AUTH_MAIL_FROM: "auth@example.test", AUTH_APP_URL: "https://app.example.test"
  });
  const password = load("src/lib/auth/password.ts");
  const session = load("src/lib/auth/session.ts");
  const errors = load("src/lib/auth/errors.ts");
  const service = load("src/lib/auth/service.ts");
  const cookieName = session.SESSION_COOKIE_NAME;
  const good = "correct horse battery staple";
  const newer = "another long secure password";

  const hashPending = password.hashPassword(good);
  const firstCompleted = await Promise.race([
    hashPending.then(() => "hash"),
    new Promise((done) => setImmediate(() => done("event-loop")))
  ]);
  assert.equal(firstCompleted, "event-loop", "scrypt must yield instead of blocking the event loop");
  const hash = await hashPending;
  assert.notEqual(hash, await password.hashPassword(good), "passwords use random salts");
  assert.equal(await password.verifyPassword(good, hash), true);
  assert.equal(await password.verifyPassword("wrong", hash), false);
  assert.equal(await password.verifyPassword(good, "malformed"), false);
  assert.equal(await password.verifyPassword(undefined, hash), false);
  assert.equal(await password.verifyPassword("x".repeat(10000), hash), false);

  assert.equal(errors.isLocalEmailAuthEnabled(), false, "production always disables local mode");
  assert.equal(await session.getOptionalSession(), null);
  await assert.rejects(session.getCurrentSession(), { name: "AuthenticationRequiredError" });
  assert.equal(state.users.length, 0);
  assert.equal(cookieWrites.length, 0);
  assert.equal((await post("login", { email: "unknown@example.test" })).status, 401);
  assert.equal((await post("login", { email: "unknown@example.test", password: good })).status, 401);
  assert.equal((await post("register", { email: "bad", password: good })).status, 400);
  assert.equal((await post("register", { email: "new@example.test", password: "short" })).status, 400);
  assert.equal((await post("register", { email: "new@example.test", password: good }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post("register", { email: "new@example.test", password: good }, { "sec-fetch-site": "cross-site" })).status, 403);

  const registration = await post("register", { email: " New@Example.Test ", password: good, nickname: "First" });
  assert.equal(registration.status, 200);
  assert.equal(state.users.length, 0, "no account before ownership proof");
  const verification = emailToken();
  assert.equal(state.tokens.length, 1);
  assert.equal(state.tokens[0].email, "new@example.test");
  assert(!JSON.stringify(state).includes(good));
  assert.equal((await post("login", { email: "new@example.test", password: good })).status, 401);
  assert.equal((await post("reset-password", { token: verification, password: newer })).status, 400, "wrong token purpose");
  transactionConflict = true;
  assert.equal((await post("verify-email", { token: verification })).status, 200, "serialization retry");
  assert.equal(state.users.length, 1);
  assert.equal((await post("verify-email", { token: verification })).status, 400, "verification single use");
  assert.equal((await post("login", { email: "new@example.test", password: "wrong" })).status, 401);
  const login = await post("login", { email: "new@example.test", password: good });
  assert.equal(login.status, 200);
  assert.equal(login.body.session.provider, "password");
  const authCookie = cookieValues.get(cookieName);
  assert.match(authCookie, /^v2\./);
  const write = cookieWrites.at(-1);
  assert.equal(write.options.secure, true);
  assert.equal(write.options.httpOnly, true);
  assert.equal(write.options.sameSite, "lax");
  assert.equal(write.options.maxAge, 60 * 60 * 24 * 30);
  const writeCount = cookieWrites.length;
  assert.equal((await session.getOptionalSession()).userId, state.users[0].id);
  assert.equal(cookieWrites.length, writeCount, "read-only session must not write cookies");
  cookieValues.set(cookieName, expiredCookie(authCookie));
  assert.equal(await session.getOptionalSession(), null);
  cookieValues.set(cookieName, authCookie.slice(0, -2) + "xx");
  assert.equal(await session.getOptionalSession(), null);
  cookieValues.set(cookieName, v1Cookie(state.users[0].id));
  assert.equal(await session.getOptionalSession(), null, "v1 denied in password mode");
  cookieValues.set(cookieName, authCookie);

  const beforeDuplicate = sent.length;
  const duplicate = await post("register", { email: "new@example.test", password: newer, nickname: "Overwrite" });
  assert.deepEqual(duplicate.body, registration.body);
  assert.equal(sent.length, beforeDuplicate);
  assert.equal(state.users[0].nickname, "First");
  assert.equal(await password.verifyPassword(good, state.credentials[0].passwordHash), true);

  const unknownForgot = await post("forgot-password", { email: "missing@example.test" });
  const forgot = await post("forgot-password", { email: "new@example.test" });
  assert.deepEqual(forgot, unknownForgot, "forgot must not enumerate accounts");
  const reset = emailToken();
  await post("forgot-password", { email: "new@example.test" });
  const otherReset = emailToken();
  assert.equal((await post("verify-email", { token: reset })).status, 400);
  failCredentialWrite = true;
  assert.equal((await post("reset-password", { token: reset, password: newer })).status, 503);
  failCredentialWrite = false;
  assert(state.tokens.some((token) => token.tokenHash === crypto.createHash("sha256").update(reset).digest("hex")), "rollback retains token");
  const raced = await Promise.all([
    post("reset-password", { token: reset, password: newer }),
    post("reset-password", { token: reset, password: newer })
  ]);
  assert.deepEqual(raced.map((response) => response.status).sort(), [200, 400]);
  assert.equal((await post("reset-password", { token: otherReset, password: good })).status, 400, "all old tokens revoked");
  cookieValues.set(cookieName, authCookie);
  assert.equal(await session.getOptionalSession(), null, "all previous password sessions revoked");
  assert.equal((await post("login", { email: "new@example.test", password: good })).status, 401);
  assert.equal((await post("login", { email: "new@example.test", password: newer })).status, 200);

  state.users.push({ id: "legacy", email: "legacy@example.test", nickname: "Legacy" });
  cookieValues.set(cookieName, v1Cookie("legacy"));
  assert.equal(await session.getOptionalSession(), null, "even legacy v1 denied outside explicit local mode");
  assert.equal((await post("login", { email: "legacy@example.test", password: good })).status, 401);
  assert.equal((await post("register", { email: "legacy@example.test", password: good })).status, 200);
  assert(!state.credentials.some((record) => record.userId === "legacy"));
  process.env.NODE_ENV = "test";
  assert.equal((await session.getOptionalSession()).userId, "legacy", "v1 allowed only in explicit local mode");
  await post("forgot-password", { email: "legacy@example.test" });
  const legacyToken = emailToken();
  assert.equal((await post("reset-password", { token: legacyToken, password: good })).status, 200);
  cookieValues.set(cookieName, v1Cookie("legacy"));
  assert.equal(await session.getOptionalSession(), null, "local v1 denied after legacy becomes password account");
  assert.equal((await post("login", { email: "legacy@example.test" })).status, 401);
  assert.equal((await post("login", { email: "legacy@example.test", password: good })).status, 200);

  await post("forgot-password", { email: "legacy@example.test" });
  const expired = emailToken();
  state.tokens.find((token) => token.email === "legacy@example.test").expiresAt = new Date(0);
  assert.equal((await post("reset-password", { token: expired, password: newer })).status, 400);

  const missingMail = sent.length;
  mailFails = true;
  assert.equal((await post("register", { email: "delivery@example.test", password: good })).status, 503);
  assert(!state.tokens.some((token) => token.email === "delivery@example.test"), "failed delivery removes token");
  assert.deepEqual(await post("forgot-password", { email: "legacy@example.test" }), unknownForgot);
  assert.deepEqual(await post("forgot-password", { email: "missing@example.test" }), unknownForgot);
  assert.equal(sent.length, missingMail);
  mailFails = false;
  delete process.env.AUTH_MAIL_API_KEY;
  assert.equal((await post("forgot-password", { email: "legacy@example.test" })).status, 503);
  assert.equal((await post("forgot-password", { email: "missing@example.test" })).status, 503);
  process.env.AUTH_MAIL_API_KEY = "private-mail-api-key";

  state.rates = [];
  const requests = await Promise.all(Array.from({ length: 12 }, () => service.enforceAuthRateLimit("rate-test", "same@example.test").then(() => 200, (error) => error.status)));
  assert.equal(requests.filter((status) => status === 200).length, 10);
  assert.equal(requests.filter((status) => status === 429).length, 2);
  assert(!JSON.stringify(state.rates).includes("same@example.test"));
  state.rates = [];
  for (let i = 0; i < 300; i++) await service.enforceAuthRateLimit("global-test", `rotating-${i}`);
  await assert.rejects(service.enforceAuthRateLimit("global-test", "rotating-301"), { status: 429 });

  dbFails = true;
  assert.equal((await post("login", { email: "dbfail@example.test", password: good })).status, 503);
  dbFails = false;
  process.env.NODE_ENV = "test";
  delete process.env.AUTH_MODE;
  cookieValues.clear();
  await assert.rejects(session.getCurrentSession(), { name: "AuthenticationRequiredError" });
  process.env.AUTH_MODE = "local-email";
  process.env.RENEWAL_REPOSITORY = "memory";
  assert.equal((await session.getCurrentSession()).provider, "mock-dev");
  assert.equal((await session.createEmailSession({ email: "local@example.test" })).provider, "local-email");
  assert.equal((await session.getOptionalSession()).email, "local@example.test");

  console.log("Auth backend passed: async salted scrypt, registration email proof, password login, legacy recovery, single-use/expiring tokens, rollback/retry, session expiry/revocation, local-mode isolation, DB rate limits, mail failure sanitization and nonenumerating HTTP responses.");
} finally {
  process.env = originalEnv;
}
