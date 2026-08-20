import { prisma } from "@/lib/prisma";

export type UserProfile = {
  id: string;
  email: string;
  nickname: string;
  timezone: string;
  language: string;
  proactiveMessagesEnabled: boolean;
  proactiveFrequencyHours: number;
  updatedAt: string;
};

export type UserProfileInput = {
  nickname?: unknown;
  timezone?: unknown;
  language?: unknown;
  proactiveMessagesEnabled?: unknown;
  proactiveFrequencyHours?: unknown;
};

type UserProfileRecord = {
  id: string;
  email: string;
  nickname: string;
  timezone: string;
  language: string;
  proactiveMessagesEnabled: boolean;
  proactiveFrequencyHours: number;
  updatedAt: Date;
};

const profileSelect = {
  id: true,
  email: true,
  nickname: true,
  timezone: true,
  language: true,
  proactiveMessagesEnabled: true,
  proactiveFrequencyHours: true,
  updatedAt: true
} as const;

export async function getUserProfile(userId: string): Promise<UserProfile> {
  if (shouldUseFallbackProfile()) {
    return getFallbackProfile(userId);
  }

  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: profileSelect
    });

    return toUserProfile(user);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    return getFallbackProfile(userId);
  }
}

export async function updateUserProfile(
  userId: string,
  input: UserProfileInput
): Promise<UserProfile> {
  const data = parseProfileInput(input);
  if (shouldUseFallbackProfile()) {
    return updateFallbackProfile(userId, data);
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: profileSelect
    });

    return toUserProfile(user);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    return updateFallbackProfile(userId, data);
  }
}

function shouldUseFallbackProfile() {
  return (
    process.env.NODE_ENV !== "production" &&
    (process.env.RENEWAL_REPOSITORY === "memory" || !process.env.DATABASE_URL)
  );
}

function parseProfileInput(input: UserProfileInput) {
  const data: {
    nickname?: string;
    timezone?: string;
    language?: string;
    proactiveMessagesEnabled?: boolean;
    proactiveFrequencyHours?: number;
  } = {};

  if ("nickname" in input) {
    data.nickname = readTrimmedString(input.nickname, "nickname", 1, 40);
  }

  if ("timezone" in input) {
    data.timezone = readTrimmedString(input.timezone, "timezone", 1, 64);
  }

  if ("language" in input) {
    data.language = readTrimmedString(input.language, "language", 2, 16);
  }

  if ("proactiveMessagesEnabled" in input) {
    if (typeof input.proactiveMessagesEnabled !== "boolean") {
      throw new ProfileValidationError("proactiveMessagesEnabled must be a boolean.");
    }

    data.proactiveMessagesEnabled = input.proactiveMessagesEnabled;
  }

  if ("proactiveFrequencyHours" in input) {
    if (
      typeof input.proactiveFrequencyHours !== "number" ||
      !Number.isInteger(input.proactiveFrequencyHours) ||
      input.proactiveFrequencyHours < 1 ||
      input.proactiveFrequencyHours > 168
    ) {
      throw new ProfileValidationError("proactiveFrequencyHours must be an integer from 1 to 168.");
    }

    data.proactiveFrequencyHours = input.proactiveFrequencyHours;
  }

  return data;
}

function readTrimmedString(
  value: unknown,
  fieldName: string,
  minLength: number,
  maxLength: number
) {
  if (typeof value !== "string") {
    throw new ProfileValidationError(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new ProfileValidationError(
      `${fieldName} must be between ${minLength} and ${maxLength} characters.`
    );
  }

  return trimmed;
}

function toUserProfile(user: UserProfileRecord): UserProfile {
  return {
    ...user,
    updatedAt: user.updatedAt.toISOString()
  };
}

function getFallbackProfile(userId: string): UserProfile {
  const store = getFallbackProfileStore();
  const existing = store.get(userId);

  if (existing) {
    return existing;
  }

  const profile: UserProfile = {
    id: userId,
    email: process.env.DEV_MOCK_USER_EMAIL ?? "dev@perpetual-renewal.local",
    nickname: process.env.DEV_MOCK_USER_NICKNAME ?? "开发用户",
    timezone: process.env.DEV_MOCK_USER_TIMEZONE ?? "Asia/Shanghai",
    language: process.env.DEV_MOCK_USER_LANGUAGE ?? "zh-CN",
    proactiveMessagesEnabled: true,
    proactiveFrequencyHours: 24,
    updatedAt: new Date().toISOString()
  };

  store.set(userId, profile);
  return profile;
}

function updateFallbackProfile(
  userId: string,
  data: ReturnType<typeof parseProfileInput>
): UserProfile {
  const current = getFallbackProfile(userId);
  const updated = {
    ...current,
    ...data,
    updatedAt: new Date().toISOString()
  };

  getFallbackProfileStore().set(userId, updated);
  return updated;
}

function getFallbackProfileStore() {
  const globalStore = globalThis as typeof globalThis & {
    __perpetualRenewalFallbackProfiles?: Map<string, UserProfile>;
  };

  globalStore.__perpetualRenewalFallbackProfiles ??= new Map<string, UserProfile>();
  return globalStore.__perpetualRenewalFallbackProfiles;
}

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}
