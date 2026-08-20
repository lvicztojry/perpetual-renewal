import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { DEMO_USER_ID } from "@/lib/renewal/types";

export const SESSION_COOKIE_NAME = "perpetual_renewal_session";

export type AppSession = {
  userId: string;
  email: string;
  provider: "mock-dev" | "local-email";
};

const cookieMaxAgeSeconds = 60 * 60 * 24 * 30;

export async function getCurrentSession(): Promise<AppSession> {
  const cookieStore = await cookies();
  const sessionUserId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (shouldUseFallbackSession()) {
    if (!sessionUserId) {
      setSessionCookie(cookieStore, DEMO_USER_ID);
    }
    return getFallbackSession();
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

    return getFallbackSession();
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
    setSessionCookie(cookieStore, DEMO_USER_ID);
    return getFallbackSession();
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

    setSessionCookie(cookieStore, DEMO_USER_ID);
    return getFallbackSession();
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

function getFallbackSession(): AppSession {
  return {
    userId: DEMO_USER_ID,
    email: process.env.DEV_MOCK_USER_EMAIL ?? "dev@perpetual-renewal.local",
    provider: "mock-dev"
  };
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
