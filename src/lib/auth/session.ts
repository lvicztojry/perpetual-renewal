import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { DEMO_USER_ID } from "@/lib/renewal/types";
import { upsertFallbackProfile } from "@/lib/users/profile";

export const SESSION_COOKIE_NAME = "perpetual_renewal_session";

export type AppSession = {
  userId: string;
  email: string;
  provider: "mock-dev" | "local-email";
};

const cookieMaxAgeSeconds = 60 * 60 * 24 * 30;

type FallbackSessionRecord = {
  userId: string;
  email: string;
  nickname: string;
};

declare global {
  var __perpetualRenewalFallbackSessions: Map<string, FallbackSessionRecord> | undefined;
}

export async function getCurrentSession(): Promise<AppSession> {
  const cookieStore = await cookies();
  const sessionUserId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (shouldUseFallbackSession()) {
    if (!sessionUserId) {
      setSessionCookie(cookieStore, DEMO_USER_ID);
      ensureFallbackSessionRecord(
        DEMO_USER_ID,
        process.env.DEV_MOCK_USER_EMAIL ?? "dev@perpetual-renewal.local",
        process.env.DEV_MOCK_USER_NICKNAME ?? "开发用户"
      );
      return getFallbackSession(DEMO_USER_ID);
    }

    return getFallbackSession(sessionUserId);
  }

  try {
    if (sessionUserId) {
      const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { id: true, email: true }
      });

      if (user) {
        return {
          userId: user.id,
          email: user.email,
          provider: "local-email"
        };
      }
    }

    const email = process.env.DEV_MOCK_USER_EMAIL ?? "dev@perpetual-renewal.local";
    const nickname = process.env.DEV_MOCK_USER_NICKNAME ?? "开发用户";

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
      provider: "mock-dev"
    };
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    return getFallbackSession(sessionUserId ?? DEMO_USER_ID);
  }
}

export async function createEmailSession(input: {
  email: string;
  nickname?: string;
}): Promise<AppSession> {
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
    const user = await prisma.user.upsert({
      where: { email },
      update: { nickname },
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
    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    const userId = createFallbackUserId(email);
    setSessionCookie(cookieStore, userId);
    ensureFallbackSessionRecord(userId, email, nickname);
    return getFallbackSession(userId);
  }
}

function shouldUseFallbackSession() {
  return (
    process.env.NODE_ENV !== "production" &&
    (process.env.RENEWAL_REPOSITORY === "memory" || !process.env.DATABASE_URL)
  );
}

export async function clearCurrentSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
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
  cookieStore.set(SESSION_COOKIE_NAME, userId, {
    httpOnly: true,
    maxAge: cookieMaxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请输入有效的邮箱地址。");
  }

  return email;
}
