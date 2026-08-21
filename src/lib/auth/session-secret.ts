export type SessionSecretSource =
  | "SESSION_COOKIE_SECRET"
  | "USER_KEY_VAULT_SECRET"
  | "dev-fallback"
  | "none";

export type SessionSecretReadiness = {
  status: "ready" | "warning" | "missing";
  source: SessionSecretSource;
  description: string;
  nextStep: string;
};

export const minimumSessionSecretBytes = 32;

const devSessionSigningSecret = "perpetual-renewal-dev-session-secret";

export function getSessionSigningSecret() {
  const configured = readConfiguredSessionSecret();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Missing session signing secret.");
    }

    return devSessionSigningSecret;
  }

  if (
    process.env.NODE_ENV === "production" &&
    Buffer.byteLength(configured.value, "utf8") < minimumSessionSecretBytes
  ) {
    throw new Error("Session signing secret must be at least 32 bytes.");
  }

  return configured.value;
}

export function getSessionSecretReadiness(): SessionSecretReadiness {
  const configured = readConfiguredSessionSecret();

  if (!configured) {
    return {
      status: "missing",
      source: "none",
      description: "未检测到 session cookie 签名 secret。",
      nextStep:
        "配置 32 bytes 以上的 SESSION_COOKIE_SECRET；如果暂不单独配置，也可以复用强 USER_KEY_VAULT_SECRET。"
    };
  }

  const isStrong =
    Buffer.byteLength(configured.value, "utf8") >= minimumSessionSecretBytes;

  if (!isStrong) {
    return {
      status: "warning",
      source: configured.source,
      description: `${configured.source} 已配置，但长度低于 ${minimumSessionSecretBytes} bytes。`,
      nextStep: "上线前替换为 32 bytes 以上强随机值，不要复用短口令。"
    };
  }

  return {
    status: "ready",
    source: configured.source,
    description:
      configured.source === "SESSION_COOKIE_SECRET"
        ? "已检测到独立 session cookie 签名 secret。"
        : "未单独配置 SESSION_COOKIE_SECRET，将复用强 USER_KEY_VAULT_SECRET 签名 session cookie。",
    nextStep:
      configured.source === "SESSION_COOKIE_SECRET"
        ? "继续确认该值只存在于本机或部署平台 secret。"
        : "可选：生产环境也可以单独配置 SESSION_COOKIE_SECRET 做密钥职责分离。"
  };
}

function readConfiguredSessionSecret() {
  const dedicated = process.env.SESSION_COOKIE_SECRET?.trim();
  if (dedicated) {
    return {
      source: "SESSION_COOKIE_SECRET" as const,
      value: dedicated
    };
  }

  const vaultFallback = process.env.USER_KEY_VAULT_SECRET?.trim();
  if (vaultFallback) {
    return {
      source: "USER_KEY_VAULT_SECRET" as const,
      value: vaultFallback
    };
  }

  return null;
}
