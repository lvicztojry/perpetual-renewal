import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError } from "./errors";
import { assertAuthMailConfigured, sendAuthMail } from "./mail";
import { hashPassword, validatePassword, verifyPassword } from "./password";

export const recoveryAccepted = {
  ok: true,
  message: "如该邮箱可接收此请求，我们会发送邮件，请检查收件箱。"
};
const invalidToken = () => new AuthError("链接无效或已过期，请重新申请。");
const invalidLogin = () => new AuthError("邮箱或密码不正确。", 401);

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") throw new AuthError("请输入有效的邮箱地址。");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError("请输入有效的邮箱地址。");
  }
  return email;
}

// Atomic increments persist across serverless instances. Keys hash the email and time window.
// A global budget prevents arbitrary email/IP rotation bypassing the scrypt/mail budget.
export async function enforceAuthRateLimit(action: string, identity: string) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const window = Math.floor(now / windowMs);
  const expiresAt = new Date((window + 1) * windowMs);
  await prisma.authRateLimit.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
  for (const [scope, limit] of [["global", 300], [identity, 10]] as const) {
    const key = createHash("sha256").update(`${action}:${scope}:${window}`).digest("hex");
    const record = await prisma.authRateLimit.upsert({
      where: { key }, create: { key, count: 1, expiresAt }, update: { count: { increment: 1 } }
    });
    if (record.count > limit) throw new AuthError("请求过于频繁，请稍后重试。", 429);
  }
}

export async function authenticatePassword(emailInput: unknown, password: unknown) {
  const email = normalizeEmail(emailInput);
  await enforceAuthRateLimit("login", email);
  const user = await prisma.user.findUnique({
    where: { email }, select: { id: true, email: true, authCredential: true }
  });
  if (!await verifyPassword(password, user?.authCredential?.passwordHash) || !user?.authCredential) {
    throw invalidLogin();
  }
  // The version read with the hash is essential: a concurrent reset must invalidate this login.
  return { userId: user.id, email: user.email, sessionVersion: user.authCredential.sessionVersion };
}

export async function registerWithPassword(input: { email?: unknown; password?: unknown; nickname?: unknown }) {
  const email = normalizeEmail(input.email);
  validatePassword(input.password);
  const nickname = typeof input.nickname === "string" ? input.nickname.trim() : email.split("@")[0];
  if (nickname.length > 80) throw new AuthError("昵称不能超过 80 个字符。");
  assertAuthMailConfigured();
  await enforceAuthRateLimit("register", email);
  // Equal password work for existing and new addresses; registration never modifies an existing User.
  const passwordHash = await hashPassword(input.password);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return recoveryAccepted;
  await issueToken({ purpose: "verify", email, nickname: nickname || "用户", passwordHash });
  return recoveryAccepted;
}

export async function forgotPassword(emailInput: unknown) {
  const email = normalizeEmail(emailInput);
  assertAuthMailConfigured();
  await enforceAuthRateLimit("forgot", email);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  // Queue/delivery errors are intentionally masked for both unknown and existing accounts.
  // Configuration is checked before lookup, so misconfiguration remains actionable without enumeration.
  if (user) {
    try { await issueToken({ purpose: "reset", email, userId: user.id }); } catch { /* Same public response. */ }
  }
  return recoveryAccepted;
}

async function issueToken(input: {
  purpose: "verify" | "reset"; email: string; userId?: string; nickname?: string; passwordHash?: string;
}) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  await prisma.authRecoveryToken.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.authRecoveryToken.create({
    data: { ...input, tokenHash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) }
  });
  try {
    await sendAuthMail(input.email, token, input.purpose);
  } catch (error) {
    await prisma.authRecoveryToken.deleteMany({ where: { tokenHash } });
    throw error;
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenDigest(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw invalidToken();
  return hashToken(value);
}

// Serializable + retry makes consuming a token, assigning a password and revoking sessions one unit.
async function transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if ((code === "P2034" || code === "P2002") && attempt < 2) continue;
      throw error;
    }
  }
}

async function consumeToken(tx: Prisma.TransactionClient, tokenHash: string, purpose: string) {
  const token = await tx.authRecoveryToken.findUnique({ where: { tokenHash } });
  if (!token || token.purpose !== purpose || token.expiresAt.getTime() <= Date.now()) throw invalidToken();
  const consumed = await tx.authRecoveryToken.deleteMany({
    where: { tokenHash, purpose, expiresAt: { gt: new Date() } }
  });
  if (consumed.count !== 1) throw invalidToken();
  return token;
}

export async function verifyRegistration(value: unknown) {
  const tokenHash = tokenDigest(value);
  await enforceAuthRateLimit("verify", tokenHash);
  await transaction(async (tx) => {
    const token = await consumeToken(tx, tokenHash, "verify");
    if (!token.passwordHash || token.userId) throw invalidToken();
    const existing = await tx.user.findUnique({ where: { email: token.email }, select: { id: true } });
    if (existing) throw invalidToken();
    await tx.user.create({
      data: {
        email: token.email, nickname: token.nickname || "用户",
        authCredential: { create: {
          passwordHash: token.passwordHash, sessionVersion: randomUUID(), emailVerifiedAt: new Date()
        } }
      }, select: { id: true }
    });
    await tx.authRecoveryToken.deleteMany({ where: { email: token.email } });
  });
}

export async function resetPassword(value: unknown, password: unknown) {
  const tokenHash = tokenDigest(value);
  validatePassword(password);
  await enforceAuthRateLimit("reset", tokenHash);
  const passwordHash = await hashPassword(password);
  await transaction(async (tx) => {
    const token = await consumeToken(tx, tokenHash, "reset");
    if (!token.userId) throw invalidToken();
    const user = await tx.user.findUnique({ where: { id: token.userId }, select: { id: true, email: true } });
    if (!user || user.email !== token.email) throw invalidToken();
    const credential = { passwordHash, sessionVersion: randomUUID(), emailVerifiedAt: new Date() };
    await tx.authCredential.upsert({
      where: { userId: user.id }, create: { userId: user.id, ...credential }, update: credential
    });
    await tx.authRecoveryToken.deleteMany({ where: { email: token.email } });
  });
}
