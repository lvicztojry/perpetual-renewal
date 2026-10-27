import { cookies } from "next/headers";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getSessionSigningSecret } from "@/lib/auth/session-secret";
import { shouldUseMemoryFallback } from "@/lib/persistence/memory-fallback";
import { prisma } from "@/lib/prisma";
import { DEMO_USER_ID } from "@/lib/renewal/types";
import { upsertFallbackProfile } from "@/lib/users/profile";
import { AuthenticationRequiredError, isLocalEmailAuthEnabled } from "./errors";

export { AuthenticationRequiredError, isLocalEmailAuthEnabled } from "./errors";

export const SESSION_COOKIE_NAME = "perpetual_renewal_session";

export type AppSession = {
  userId: string;
  email: string;
  provider: "mock-dev" | "local-email" | "password";
};

const cookieMaxAgeSeconds = 60 * 60 * 24 * 30;
const sessionCookieVersion = "v1";

type FallbackSessionRecord = {
  userId: string;
  email: string;
  nickname: string;
};

declare global {
  var __perpetualRenewalFallbackSessions: Map<string, FallbackSessionRecord> | undefined;
}

export async function getCurrentSession(): Promise<AppSession> {
  const current = await getOptionalSession();
  if (current) return current;
  if (!isLocalEmailAuthEnabled()) throw new AuthenticationRequiredError();
  const cookieStore = await cookies();

  if (shouldUseFallbackSession()) {
    setSessionCookie(cookieStore, DEMO_USER_ID);
    ensureFallbackSessionRecord(
      DEMO_USER_ID,
      process.env.DEV_MOCK_USER_EMAIL ?? "dev@perpetual-renewal.local",
      process.env.DEV_MOCK_USER_NICKNAME ?? "开发用户"
    );
    return getFallbackSession(DEMO_USER_ID);
  }
  const session = await createEmailSession({
    email: process.env.DEV_MOCK_USER_EMAIL ?? "dev@perpetual-renewal.local",
    nickname: process.env.DEV_MOCK_USER_NICKNAME ?? "开发用户"
  });
  return { ...session, provider: "mock-dev" };
}

// Read only: safe for server components. Never creates demo users or writes cookies.
export async function getOptionalSession(): Promise<AppSession | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const payload = readV2SessionCookie(value);
  if (payload?.provider === "password") {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, authCredential: { select: { sessionVersion: true } } }
    });
    return user?.authCredential && user.authCredential.sessionVersion === payload.sessionVersion
      ? { userId: user.id, email: user.email, provider: "password" } : null;
  }
  if (!isLocalEmailAuthEnabled()) return null;
  const userId = payload?.provider === "local-email" ? payload.userId : readSessionCookie(value);
  if (!userId) return null;
  if (shouldUseFallbackSession()) {
    return getFallbackSessionStore().has(userId) ? getFallbackSession(userId) : null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { id: true, email: true, authCredential: { select: { userId: true } } }
  });
  // Even explicit local mode cannot use a passwordless cookie for a password-auth user.
  return user && !user.authCredential ? { userId: user.id, email: user.email, provider: "local-email" } : null;
}

export async function createPasswordSession(input: { userId: string; email: string; sessionVersion: string }): Promise<AppSession> {
  const cookieStore = await cookies();
  setV2SessionCookie(cookieStore, input.userId, "password", input.sessionVersion);
  return { userId: input.userId, email: input.email, provider: "password" };
}

export async function createEmailSession(input: {
  email: string;
  nickname?: string;
}): Promise<AppSession> {
  if (!isLocalEmailAuthEnabled()) throw new AuthenticationRequiredError();
  const cookieStore = await cookies();
  const email = normalizeEmail(input.email);
  const nickname = input.nickname?.trim() || email.split("@")[0] || "用户";

  if (shouldUseFallbackSession()) {
    const userId = createFallbackUserId(email);
    setSessionCookie(cookieStore, userId);
    ensureFallbackSessionRecord(userId, email, nickname);
    return getFallbackSession(userId);
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { email }, select: { authCredential: { select: { userId: true } } }
    });
    if (existing?.authCredential) throw new AuthenticationRequiredError();
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        nickname,
        timezone: process.env.DEV_MOCK_USER_TIMEZONE ?? "Asia/Shanghai",
        language: process.env.DEV_MOCK_USER_LANGUAGE ?? "zh-CN"
      },
      select: { id: true, email: true }
    });

    setSessionCookie(cookieStore, user.id);

    return {
      userId: user.id,
      email: user.email,
      provider: "local-email"
    };
  } catch (error) {
    if (!shouldUseFallbackSession()) {
      throw error;
    }

    const userId = createFallbackUserId(email);
    setSessionCookie(cookieStore, userId);
    ensureFallbackSessionRecord(userId, email, nickname);
    return getFallbackSession(userId);
  }
}

function shouldUseFallbackSession() {
  return isLocalEmailAuthEnabled() && shouldUseMemoryFallback();
}

export async function clearCurrentSession() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

function getFallbackSession(userId: string): AppSession {
  const record = getFallbackSessionStore().get(userId);
  return {
    userId,
    email: record?.email ?? process.env.DEV_MOCK_USER_EMAIL ?? "dev@perpetual-renewal.local",
    provider: userId === DEMO_USER_ID ? "mock-dev" : "local-email"
  };
}

function ensureFallbackSessionRecord(userId: string, email: string, nickname: string) {
  const store = getFallbackSessionStore();
  const existing = store.get(userId);
  if (existing) {
    const record = { userId, email, nickname };
    store.set(userId, record);
    upsertFallbackProfile(userId, { email, nickname });
    return record;
  }

  const record = { userId, email, nickname };
  store.set(userId, record);
  upsertFallbackProfile(userId, { email, nickname });
  return record;
}

function createFallbackUserId(email: string) {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 16);
  return `memory-user-${digest}`;
}

function getFallbackSessionStore() {
  globalThis.__perpetualRenewalFallbackSessions ??= new Map();
  return globalThis.__perpetualRenewalFallbackSessions;
}

function setSessionCookie(cookieStore: Awaited<ReturnType<typeof cookies>>, userId: string) {
  setV2SessionCookie(cookieStore, userId, "local-email");
}

type SessionPayload = {
  userId: string;
  provider: "password" | "local-email";
  expiresAt: number;
  sessionVersion?: string;
};

function setV2SessionCookie(cookieStore: Awaited<ReturnType<typeof cookies>>, userId: string, provider: SessionPayload["provider"], sessionVersion?: string) {
  const payload: SessionPayload = { userId, provider, sessionVersion, expiresAt: Date.now() + cookieMaxAgeSeconds * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signSessionPayload(`v2.${encoded}`);
  cookieStore.set(SESSION_COOKIE_NAME, `v2.${encoded}.${signature}`, {
    httpOnly: true,
    maxAge: cookieMaxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

function readV2SessionCookie(value?: string): SessionPayload | undefined {
  if (!value || value.length > 2048) return undefined;
  const [version, encoded, signature, extra] = value.split(".");
  if (version !== "v2" || !encoded || !signature || extra !== undefined) return undefined;
  if (!safeEqual(signature, signSessionPayload(`v2.${encoded}`))) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.userId !== "string" || !payload.userId || payload.userId.length > 128 ||
        !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now() ||
        payload.expiresAt > Date.now() + cookieMaxAgeSeconds * 1000 ||
        (payload.provider !== "password" && payload.provider !== "local-email") ||
        (payload.provider === "password" && (typeof payload.sessionVersion !== "string" || !payload.sessionVersion))) return undefined;
    return payload;
  } catch { return undefined; }
}

function readSessionCookie(value?: string) {
  if (!isLocalEmailAuthEnabled()) return undefined;
  if (!value) return undefined;

  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== sessionCookieVersion) {
    return undefined;
  }

  const [, encodedUserId, signature] = parts;
  const expectedSignature = signSessionPayload(encodedUserId);

  if (!safeEqual(signature, expectedSignature)) {
    return undefined;
  }

  try {
    const userId = Buffer.from(encodedUserId, "base64url").toString("utf8");
    return userId.length > 0 && userId.length <= 128 ? userId : undefined;
  } catch {
    return undefined;
  }
}

function signSessionPayload(encodedUserId: string) {
  return createHmac("sha256", getSessionSigningSecret()).update(encodedUserId).digest("base64url");
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请输入有效的邮箱地址。");
  }

  return email;
}
