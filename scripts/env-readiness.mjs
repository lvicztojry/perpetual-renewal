import process from "node:process";
import { loadLocalEnv } from "./load-local-env.mjs";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const requireServerLlm = args.has("--server-llm-required");
const noLocalEnv = args.has("--no-local-env");
const minimumSecretBytes = 32;

if (!noLocalEnv) {
  loadLocalEnv();
}

const checks = [
  databaseCheck(),
  databaseUnpooledCheck(),
  secretCheck("USER_KEY_VAULT_SECRET", "用户 API key vault 加密主密钥"),
  sessionCookieSecretCheck(),
  proactiveCronSecretCheck(),
  llmProviderCheck(),
  llmCredentialCheck(),
  llmModelCheck(),
  voiceCheck()
];

const missing = checks.filter((check) => check.status === "missing");
const warnings = checks.filter((check) => check.status === "warning");
const ready = checks.filter((check) => check.status === "ready");

console.log("Environment readiness");
console.log(`ready=${ready.length} warning=${warnings.length} missing=${missing.length}`);
console.log("");

for (const check of checks) {
  console.log(`${iconFor(check.status)} ${check.label}`);
  console.log(`  status: ${check.status}`);
  console.log(`  detail: ${check.detail}`);
  console.log(`  next: ${check.next}`);
}

if (strict && missing.some((check) => check.required)) {
  console.error("");
  console.error("Strict readiness failed: required production configuration is missing.");
  process.exit(1);
}

if (strict && warnings.some((check) => check.strictWarning)) {
  console.error("");
  console.error("Strict readiness failed: production configuration has warnings.");
  process.exit(1);
}

function databaseCheck() {
  const configured = Boolean(process.env.DATABASE_URL?.trim());
  return {
    label: "DATABASE_URL",
    status: configured ? "ready" : "missing",
    required: true,
    strictWarning: false,
    detail: configured
      ? "PostgreSQL connection is configured."
      : "No database URL found; local development will use memory fallback.",
    next: configured
      ? "Run npm run db:smoke against the target database before release."
      : "Set a Neon/PostgreSQL DATABASE_URL in .env.local or deployment secrets."
  };
}

function databaseUnpooledCheck() {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim();
  const databaseConfigured = Boolean(databaseUrl);
  const appearsPooled = /-pooler[.\-]/i.test(databaseUrl);

  if (!databaseConfigured) {
    return {
      label: "DATABASE_URL_UNPOOLED",
      status: "warning",
      required: false,
      strictWarning: false,
      detail: "Direct migration URL is not checked until DATABASE_URL is configured.",
      next: "For Neon, keep DATABASE_URL pooled for app traffic and set DATABASE_URL_UNPOOLED for migrations."
    };
  }

  if (unpooled) {
    return {
      label: "DATABASE_URL_UNPOOLED",
      status: "ready",
      required: false,
      strictWarning: false,
      detail: "A direct database URL is configured for Prisma migrations.",
      next: "Keep the value out of source control and deployment logs."
    };
  }

  return {
    label: "DATABASE_URL_UNPOOLED",
    status: appearsPooled ? "warning" : "ready",
    required: false,
    strictWarning: false,
    detail: appearsPooled
      ? "DATABASE_URL appears to use Neon pooling; migrations are more reliable with a direct URL."
      : "DATABASE_URL does not look pooled; migrations can use it directly.",
    next: appearsPooled
      ? "Set DATABASE_URL_UNPOOLED to the Neon direct connection string when available."
      : "No action needed unless your database provider gives a separate migration URL."
  };
}

function secretCheck(name, label) {
  const value = process.env[name]?.trim();
  if (!value) {
    return {
      label: name,
      status: "missing",
      required: true,
      strictWarning: false,
      detail: `${label} is not configured.`,
      next: "Generate a 32-byte-or-longer random value and store it only in local/deployment secrets."
    };
  }

  if (Buffer.byteLength(value, "utf8") < minimumSecretBytes) {
    return {
      label: name,
      status: "warning",
      required: true,
      strictWarning: true,
      detail: `${label} is present but shorter than ${minimumSecretBytes} bytes.`,
      next: "Replace it with a stronger random value before production."
    };
  }

  return {
    label: name,
    status: "ready",
    required: true,
    strictWarning: false,
    detail: `${label} is configured with sufficient length.`,
    next: "Keep the value out of source control and screenshots."
  };
}

function sessionCookieSecretCheck() {
  const dedicated = process.env.SESSION_COOKIE_SECRET?.trim();
  const fallback = process.env.USER_KEY_VAULT_SECRET?.trim();
  const source = dedicated ? "SESSION_COOKIE_SECRET" : fallback ? "USER_KEY_VAULT_SECRET" : null;
  const value = dedicated || fallback;

  if (!value) {
    return {
      label: "SESSION_COOKIE_SECRET",
      status: "missing",
      required: true,
      strictWarning: false,
      detail: "No session signing secret found.",
      next: "Set a 32-byte-or-longer SESSION_COOKIE_SECRET, or configure a strong USER_KEY_VAULT_SECRET fallback."
    };
  }

  if (Buffer.byteLength(value, "utf8") < minimumSecretBytes) {
    return {
      label: "SESSION_COOKIE_SECRET",
      status: "warning",
      required: true,
      strictWarning: true,
      detail: `${source} is present but too short for session cookie signing.`,
      next: "Replace it with a 32-byte-or-longer random value before production."
    };
  }

  return {
    label: "SESSION_COOKIE_SECRET",
    status: "ready",
    required: true,
    strictWarning: false,
    detail:
      source === "SESSION_COOKIE_SECRET"
        ? "A dedicated session signing secret is configured."
        : "Session signing will reuse the strong USER_KEY_VAULT_SECRET fallback.",
    next:
      source === "SESSION_COOKIE_SECRET"
        ? "Keep the value out of source control and screenshots."
        : "Optionally set SESSION_COOKIE_SECRET separately to split signing and vault responsibilities."
  };
}

function proactiveCronSecretCheck() {
  const primary = process.env.PROACTIVE_CRON_SECRET?.trim();
  const vercelAlias = process.env.CRON_SECRET?.trim();
  const source = primary ? "PROACTIVE_CRON_SECRET" : vercelAlias ? "CRON_SECRET" : null;
  const value = primary || vercelAlias;

  if (!value) {
    return {
      label: "PROACTIVE_CRON_SECRET",
      status: "missing",
      required: true,
      strictWarning: false,
      detail: "主动回响 all-user cron 密钥 is not configured.",
      next: "Set PROACTIVE_CRON_SECRET, or CRON_SECRET for Vercel Cron, to a 32-byte-or-longer random value."
    };
  }

  if (Buffer.byteLength(value, "utf8") < minimumSecretBytes) {
    return {
      label: "PROACTIVE_CRON_SECRET",
      status: "warning",
      required: true,
      strictWarning: true,
      detail: `${source} is present but shorter than ${minimumSecretBytes} bytes.`,
      next: "Replace it with a stronger random value before production."
    };
  }

  return {
    label: "PROACTIVE_CRON_SECRET",
    status: "ready",
    required: true,
    strictWarning: false,
    detail:
      source === "CRON_SECRET"
        ? "Vercel Cron CRON_SECRET alias is configured with sufficient length."
        : "主动回响 all-user cron 密钥 is configured with sufficient length.",
    next: "Keep the value out of source control and screenshots."
  };
}

function llmProviderCheck() {
  const provider = normalizeProvider(process.env.LLM_PROVIDER);
  return {
    label: "LLM_PROVIDER",
    status: provider ? "ready" : "warning",
    required: false,
    strictWarning: false,
    detail: provider
      ? `Provider mode is ${provider}.`
      : "Unknown provider; runtime will fall back to compatible/mock behavior.",
    next: provider ? "No action needed." : "Use compatible, anthropic, gemini, or openai-responses."
  };
}

function llmCredentialCheck() {
  const provider = normalizeProvider(process.env.LLM_PROVIDER) ?? "compatible";
  const hasServerKey = Boolean(readServerLlmKey(provider));

  if (hasServerKey) {
    return {
      label: "LLM API key",
      status: "ready",
      required: false,
      strictWarning: false,
      detail: "A server-side LLM key is configured.",
      next: "For user-owned billing, prefer saving user keys in the settings page vault."
    };
  }

  return {
    label: "LLM API key",
    status: requireServerLlm ? "missing" : "warning",
    required: requireServerLlm,
    strictWarning: false,
    detail: "No server-side LLM key found. This is acceptable if users bring their own API key.",
    next: "Save a user API key in the settings page vault, or configure LLM_API_KEY as a server fallback."
  };
}

function llmModelCheck() {
  const configured = Boolean(process.env.LLM_MODEL?.trim());
  return {
    label: "LLM_MODEL",
    status: configured ? "ready" : "warning",
    required: false,
    strictWarning: false,
    detail: configured ? "A server-side model name is configured." : "No server-side model name found.",
    next: configured
      ? "Use the settings page connection test to verify the selected model."
      : "Users can select a model in settings, or you can set LLM_MODEL as a server fallback."
  };
}

function voiceCheck() {
  const provider = process.env.VOICE_PROVIDER?.trim() || "shared-llm";
  const shared = provider === "shared-llm" || provider === "compatible";
  return {
    label: "VOICE_PROVIDER",
    status: shared ? "ready" : "warning",
    required: false,
    strictWarning: false,
    detail: shared
      ? "Voice is configured to share the LLM-compatible gateway."
      : "Voice provider is not the default shared gateway mode.",
    next: shared
      ? "Set VOICE_STT_MODEL and VOICE_TTS_MODEL if the gateway requires specific audio models."
      : "Confirm the provider supports compatible STT/TTS endpoints."
  };
}

function normalizeProvider(value) {
  const provider = value?.trim() || "compatible";
  if (provider === "openai-compatible") return "compatible";
  if (
    provider === "compatible" ||
    provider === "anthropic" ||
    provider === "gemini" ||
    provider === "openai-responses"
  ) {
    return provider;
  }

  return null;
}

function readServerLlmKey(provider) {
  if (process.env.LLM_API_KEY?.trim()) return process.env.LLM_API_KEY.trim();
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY?.trim();
  if (provider === "gemini") {
    return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  }
  return process.env.OPENAI_API_KEY?.trim();
}

function iconFor(status) {
  if (status === "ready") return "[ok]";
  if (status === "warning") return "[warn]";
  return "[missing]";
}
