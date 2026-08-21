import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowedPlaceholderValues = new Set([
  "",
  "...",
  "changeme",
  "placeholder",
  "redacted",
  "[redacted]",
  "generate-a-long-random-secret",
  "generate-a-different-long-random-secret",
  "32-byte-or-longer-random-secret",
  "random-cron-secret",
  "neon or postgresql connection string",
  "postgresql://user:password@host:port/database?schema=public"
]);
const envKeyPattern =
  /^\s*([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)|DATABASE_URL|CLIENT_SECRET|PRIVATE_KEY|PROACTIVE_CRON_SECRET|USER_KEY_VAULT_SECRET)\s*=\s*(.*)$/i;
const secretLikePatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /Bearer\s+(?!<|\[?REDACTED\]?|placeholder\b|token\b)[A-Za-z0-9._~+/=-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:vaultCiphertext|encryptedKey|encryptedValue|ciphertext|encryptedApiKey|keyIv|keyAuthTag)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/i
];

const files = readTargetFiles();

const findings = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const envMatch = line.match(envKeyPattern);
    if (envMatch) {
      const rawValue = envMatch[2].trim().replace(/^['"]|['"]$/g, "");
      if (!isAllowedPlaceholder(rawValue)) {
        findings.push(`${file}:${index + 1} contains a non-placeholder secret or database value.`);
      }
    }

    if (secretLikePatterns.some((pattern) => pattern.test(line))) {
      findings.push(`${file}:${index + 1} contains a value that looks like an API secret.`);
    }

    const databaseUrl = line.match(/postgres(?:ql)?:\/\/([^:\s/]+):([^@\s]+)@/i);
    if (databaseUrl && !isPlaceholderCredential(databaseUrl[1], databaseUrl[2])) {
      findings.push(`${file}:${index + 1} contains a database URL with embedded credentials.`);
    }
  });
}

if (findings.length > 0) {
  console.error("Potential secret leaks found:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Secret leak check passed for ${files.length} committable files.`);

function readTargetFiles() {
  const args = process.argv.slice(2);
  if (args[0] === "--files") {
    return args
      .slice(1)
      .map((file) => file.trim())
      .filter(Boolean);
  }

  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8"
  })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith("node_modules/") && !file.startsWith(".next/"));
}

function isAllowedPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    allowedPlaceholderValues.has(normalized) ||
    normalized.startsWith("<") ||
    normalized.startsWith("[") ||
    normalized.includes("placeholder") ||
    normalized.includes("your-") ||
    normalized.includes("provider-")
  );
}

function isPlaceholderCredential(user, password) {
  const placeholders = new Set(["user", "username", "password", "pass", "postgres", "example"]);
  return placeholders.has(user.toLowerCase()) && placeholders.has(password.toLowerCase());
}
