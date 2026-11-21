import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function initializeCloud(directory, { url: input, emails: inputEmails }) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port || isIP(url.hostname) || !url.hostname.includes(".") || !/^[a-z0-9.-]+$/.test(url.hostname)) {
    throw new Error("Use the final HTTPS domain, without a path, port or credentials.");
  }
  const emails = [...new Set(String(inputEmails || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length || emails.some(email => email.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) || /[\r\n]/.test(email))) {
    throw new Error("Provide a comma-separated list of invited email addresses.");
  }
  const paths = ["cloud.env", "scheduler.env", "site.env", ".secrets/db_password"];
  if (paths.some(path => existsSync(join(directory, path)))) throw new Error("Cloud configuration exists; no files were overwritten.");
  mkdirSync(join(directory, ".secrets"), { recursive: true, mode: 0o700 });
  const secret = () => randomBytes(32).toString("hex");
  const password = secret();
  const cron = secret();
  const database = new URL("postgresql://db:5432/renewal?schema=public");
  database.username = "renewal";
  database.password = password;
  // Compose env_file format: raw. Values are literal, single-line and unquoted.
  const config = {
    NODE_ENV: "production", AUTH_MODE: "password", RENEWAL_REPOSITORY: "prisma",
    DATABASE_URL: database.toString(),
    DATABASE_URL_UNPOOLED: "", AUTH_APP_URL: url.origin, AUTH_ALLOWED_EMAILS: emails.join(","),
    USER_KEY_VAULT_SECRET: secret(), SESSION_COOKIE_SECRET: secret(), PROACTIVE_CRON_SECRET: cron,
    AUTH_MAIL_TRANSPORT: "smtp", AUTH_MAIL_FROM: "", AUTH_SMTP_HOST: "", AUTH_SMTP_PORT: "465",
    AUTH_SMTP_USER: "", AUTH_SMTP_PASSWORD: "", AUTH_MAIL_API_URL: "", AUTH_MAIL_API_KEY: "",
    LLM_PROVIDER: "compatible", LLM_API_KEY: "", LLM_BASE_URL: "", LLM_MODEL: "",
    LLM_INPUT_COST_USD_PER_1M: "0", LLM_OUTPUT_COST_USD_PER_1M: "0",
    VOICE_PROVIDER: "shared-llm", VOICE_STT_MODEL: "", VOICE_TTS_MODEL: "",
    VOICE_DEFAULT_VOICE: "warm", VOICE_CREDENTIAL_SOURCE: "server-env"
  };
  const save = (path, value) => writeFileSync(join(directory, path), value, { flag: "wx", mode: 0o600 });
  save("cloud.env", Object.entries(config).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
  save("scheduler.env", `PROACTIVE_CRON_SECRET=${cron}\n`);
  save("site.env", `SITE_ADDRESS=${url.hostname}\n`);
  save(".secrets/db_password", password);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const value = flag => args[args.indexOf(flag) + 1];
    if (!args.includes("--url") || !args.includes("--emails")) throw new Error("Usage: node deploy/init.mjs --url https://YOUR_DOMAIN --emails owner@example.com,friend@example.com");
    initializeCloud(fileURLToPath(new URL("./", import.meta.url)), { url: value("--url"), emails: value("--emails") });
    console.log("Cloud files created. Fill in mail and default model settings in deploy/cloud.env. No secret values were printed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
