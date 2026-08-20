import { createHash, createHmac } from "node:crypto";

export function buildSafetyEventHashes(input: {
  userId: string;
  type: string;
  action: string;
  stage: string;
  severity: string;
  content: string;
}) {
  const normalizedContent = normalizeForHash(input.content);
  const contentHash = digest(normalizedContent);
  const riskHash = digest(
    [
      input.userId,
      input.type,
      input.action,
      input.stage,
      input.severity,
      normalizedContent
    ].join("\0")
  );

  return { contentHash, riskHash };
}

function normalizeForHash(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function digest(value: string) {
  const secret = process.env.USER_KEY_VAULT_SECRET?.trim();

  if (secret) {
    return `hmac-sha256:${createHmac("sha256", secret).update(value).digest("hex")}`;
  }

  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
