import { getLlmCredentialStatus } from "@/lib/credentials";

export type ConfigReadinessStatus = "ready" | "warning" | "missing";

export type ConfigReadinessItem = {
  id: string;
  label: string;
  status: ConfigReadinessStatus;
  description: string;
  nextStep: string;
};

export type ConfigReadinessSnapshot = {
  checkedAt: string;
  summary: {
    readyCount: number;
    warningCount: number;
    missingCount: number;
    productionReady: boolean;
  };
  items: ConfigReadinessItem[];
};

const minimumSecretBytes = 32;

export async function getConfigReadinessSnapshot(
  userId: string
): Promise<ConfigReadinessSnapshot> {
  const credential = await getLlmCredentialStatus(userId);
  const llmProvider = normalizeProvider(credential.provider ?? process.env.LLM_PROVIDER);
  const llmKeyConfigured = Boolean(credential.configured || readAnyLlmApiKey(llmProvider));
  const llmBaseUrlConfigured =
    llmProvider === "compatible"
      ? Boolean(credential.baseUrl?.trim() || process.env.LLM_BASE_URL?.trim())
      : true;
  const llmModelConfigured = Boolean(credential.model || process.env.LLM_MODEL?.trim());
  const voiceProvider = process.env.VOICE_PROVIDER?.trim() || "shared-llm";

  const items: ConfigReadinessItem[] = [
    {
      id: "database",
      label: "PostgreSQL 数据库",
      status: process.env.DATABASE_URL?.trim() ? "ready" : "missing",
      description: process.env.DATABASE_URL?.trim()
        ? "已检测到数据库连接配置。"
        : "当前未检测到数据库连接，本地会使用内存 fallback。",
      nextStep: process.env.DATABASE_URL?.trim()
        ? "上线前继续执行 prisma migrate 和 db:smoke。"
        : "在本机 .env.local 或部署平台 secret 中配置 Neon PostgreSQL DATABASE_URL。"
    },
    secretItem({
      id: "vault_secret",
      label: "用户密钥 vault secret",
      envName: "USER_KEY_VAULT_SECRET",
      configuredDescription: "已检测到用户 API key 加密主密钥。",
      missingNextStep:
        "生成 32 bytes 以上强随机值，并只写入 .env.local 或部署平台 secret。"
    }),
    secretItem({
      id: "cron_secret",
      label: "主动回响 cron secret",
      envName: "PROACTIVE_CRON_SECRET",
      configuredDescription: "已检测到 all-user 主动回响调度密钥。",
      missingNextStep:
        "生成另一段强随机值，不能和 vault secret、数据库密码或 API key 复用。"
    }),
    {
      id: "llm_key",
      label: "LLM API key",
      status: llmKeyConfigured ? "ready" : "missing",
      description: llmKeyConfigured
        ? credential.configured
          ? "当前用户已保存加密 LLM key。"
          : "服务端环境变量已提供 LLM key。"
        : "未检测到用户 vault key 或服务端 LLM key。",
      nextStep: llmKeyConfigured
        ? "可以在设置页读取模型列表或测试连接。"
        : "在设置页保存自己的 API key，或在服务端配置 LLM_API_KEY。"
    },
    {
      id: "llm_model",
      label: "LLM 模型名",
      status: llmModelConfigured ? "ready" : "warning",
      description: llmModelConfigured ? "已检测到模型名配置。" : "尚未检测到模型名。",
      nextStep: llmModelConfigured
        ? "上线前用设置页测试连接确认供应商可用。"
        : "保存 key 后读取模型列表并选择模型，或配置 LLM_MODEL。"
    },
    {
      id: "llm_base_url",
      label: "兼容中转站 Base URL",
      status: llmBaseUrlConfigured ? "ready" : "missing",
      description: llmBaseUrlConfigured
        ? "兼容供应商的 Base URL 已配置或可由用户 vault 提供。"
        : "compatible provider 需要 Base URL。",
      nextStep: llmBaseUrlConfigured
        ? "默认推荐 TryAnotherOne 兼容中转站。"
        : "配置 LLM_BASE_URL，推荐 https://api.tryanotherone.com/v1。"
    },
    {
      id: "voice",
      label: "语音供应商",
      status: voiceProvider === "shared-llm" || voiceProvider === "compatible" ? "ready" : "warning",
      description:
        voiceProvider === "shared-llm" || voiceProvider === "compatible"
          ? "语音已配置为与 LLM 共用中转站。"
          : "语音供应商不是默认共用中转站模式。",
      nextStep:
        voiceProvider === "shared-llm" || voiceProvider === "compatible"
          ? "按供应商能力填写 VOICE_STT_MODEL 和 VOICE_TTS_MODEL；为空时会回落到 LLM_MODEL。"
          : "确认语音供应商是否具备兼容 STT/TTS 接口。"
    }
  ];

  const readyCount = items.filter((item) => item.status === "ready").length;
  const warningCount = items.filter((item) => item.status === "warning").length;
  const missingCount = items.filter((item) => item.status === "missing").length;

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      readyCount,
      warningCount,
      missingCount,
      productionReady: missingCount === 0 && warningCount === 0
    },
    items
  };
}

function secretItem(input: {
  id: string;
  label: string;
  envName: "USER_KEY_VAULT_SECRET" | "PROACTIVE_CRON_SECRET";
  configuredDescription: string;
  missingNextStep: string;
}): ConfigReadinessItem {
  const value = process.env[input.envName]?.trim();
  if (!value) {
    return {
      id: input.id,
      label: input.label,
      status: "missing",
      description: "未检测到生产 secret。",
      nextStep: input.missingNextStep
    };
  }

  if (Buffer.byteLength(value, "utf8") < minimumSecretBytes) {
    return {
      id: input.id,
      label: input.label,
      status: "warning",
      description: "已检测到 secret，但长度偏短。",
      nextStep: "更换为 32 bytes 以上强随机值，不要写入仓库。"
    };
  }

  return {
    id: input.id,
    label: input.label,
    status: "ready",
    description: input.configuredDescription,
    nextStep: "继续确认该值只存在于本机或部署平台 secret。"
  };
}

function normalizeProvider(value: string | null | undefined) {
  if (value === "openai-compatible") {
    return "compatible";
  }

  if (value === "anthropic" || value === "gemini" || value === "openai-responses") {
    return value;
  }

  return "compatible";
}

function readAnyLlmApiKey(provider: string) {
  const neutralKey = process.env.LLM_API_KEY?.trim();
  if (neutralKey) return neutralKey;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY?.trim();
  if (provider === "gemini") {
    return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  }
  return process.env.OPENAI_API_KEY?.trim();
}
