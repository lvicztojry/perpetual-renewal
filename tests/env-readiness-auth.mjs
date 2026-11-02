import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
// Deliberately synthetic: never inherit application configuration or load local env files.
const platformEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["SYSTEMROOT", "WINDIR", "TEMP", "TMP"].includes(key.toUpperCase())
));
const fixture = {
  DATABASE_URL: "postgresql://user:password@ep-fixture-pooler.us-east-2.aws.neon.tech/fixture-db?sslmode=require",
  USER_KEY_VAULT_SECRET: "fixture-vault-secret-with-at-least-32-bytes",
  SESSION_COOKIE_SECRET: "fixture-session-secret-with-at-least-32-bytes",
  PROACTIVE_CRON_SECRET: "fixture-cron-secret-with-at-least-32-bytes",
  AUTH_APP_URL: "https://app.example.invalid",
  AUTH_MAIL_FROM: "fixture-sender@example.invalid",
  AUTH_MAIL_TRANSPORT: "smtp",
  AUTH_SMTP_HOST: "smtp.qq.com",
  AUTH_SMTP_PORT: "465",
  AUTH_SMTP_USER: "fixture-user@example.invalid",
  AUTH_SMTP_PASSWORD: "fixture-smtp-app-password",
  LLM_PROVIDER: "compatible",
  VOICE_PROVIDER: "shared-llm"
};

function run(overrides = {}, strict = true) {
  const env = { ...platformEnv, ...fixture, ...overrides };
  const result = spawnSync(process.execPath, [
    "scripts/env-readiness.mjs", "--no-local-env", ...(strict ? ["--strict"] : [])
  ], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const output = result.stdout + result.stderr;
  // Assert both successful and failing runs redact all configured sensitive values.
  for (const [key, value] of Object.entries(env)) {
    if (value && /SECRET|PASSWORD|API_KEY|DATABASE_URL|AUTH_.*(?:URL|FROM|USER|HOST)/.test(key)) {
      assert.ok(!output.includes(value), `diagnostics must not expose ${key}`);
    }
  }
  const checks = Object.fromEntries([...result.stdout.matchAll(
    /^\[(?:ok|warn|missing)\] (.+)\r?\n  status: (ready|warning|missing)\r?\n  detail: (.*)\r?\n  next: (.*)/gm
  )].map(([, label, status, detail, next]) => [label, { status, detail, next }]));
  assert.equal(Object.keys(checks).length, 11, "all readiness checks should be reported");
  return { ...result, output, checks };
}

function missingLabels(result) {
  return Object.entries(result.checks).filter(([, check]) => check.status === "missing").map(([label]) => label);
}

test("HTTPS with QQ SMTP configuration passes strict readiness", () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.deepEqual(missingLabels(result), []);
  assert.equal(result.checks.AUTH_MAIL.status, "ready");
  assert.equal(result.checks.AUTH_APP_URL.status, "ready");
});

test("local HTTP fails strict readiness only for AUTH_APP_URL", () => {
  const result = run({ AUTH_APP_URL: "http://localhost:3000" });
  assert.equal(result.status, 1);
  assert.deepEqual(missingLabels(result), ["AUTH_APP_URL"]);
  assert.equal(result.checks.AUTH_MAIL.status, "ready");
  assert.equal(result.checks.AUTH_MAIL.detail, run().checks.AUTH_MAIL.detail);
  assert.equal(run({ AUTH_APP_URL: "http://localhost:3000" }, false).status, 0);
});

test("missing SMTP password is labeled AUTH_MAIL", () => {
  const result = run({ AUTH_SMTP_PASSWORD: "   " });
  assert.equal(result.status, 1);
  assert.deepEqual(missingLabels(result), ["AUTH_MAIL"]);
  assert.match(result.checks.AUTH_MAIL.next, /SMTP.*app password/);
  assert.ok(!result.checks.AUTH_MAIL.next.includes("AUTH_APP_URL"));
});

test("app URL validation retains HTTPS and no embedded credentials requirements", () => {
  for (const AUTH_APP_URL of ["", "invalid-app-url", "https://fixture-user:fixture-password@app.example.invalid"]) {
    const result = run({ AUTH_APP_URL });
    assert.equal(result.status, 1);
    assert.deepEqual(missingLabels(result), ["AUTH_APP_URL"]);
  }
});

const gateway = {
  AUTH_MAIL_TRANSPORT: "http",
  AUTH_MAIL_API_URL: "https://gateway.example.invalid/send",
  AUTH_MAIL_API_KEY: "fixture-gateway-api-key",
  AUTH_SMTP_PASSWORD: ""
};

test("HTTPS mail gateway works independently of SMTP and app URL", () => {
  assert.equal(run(gateway).status, 0);
  assert.equal(run({ ...gateway, AUTH_MAIL_TRANSPORT: "" }).status, 0);
  const result = run({ ...gateway, AUTH_APP_URL: "http://localhost:3000" });
  assert.equal(result.status, 1);
  assert.deepEqual(missingLabels(result), ["AUTH_APP_URL"]);
});

test("invalid HTTP gateway configuration is always labeled AUTH_MAIL", () => {
  for (const overrides of [
    { AUTH_MAIL_API_URL: "http://gateway.example.invalid/send" },
    { AUTH_MAIL_API_URL: "invalid-gateway-url" },
    { AUTH_MAIL_API_URL: "https://fixture-user:fixture-password@gateway.example.invalid/send" },
    { AUTH_MAIL_API_URL: "" },
    { AUTH_MAIL_API_KEY: "" },
    { AUTH_MAIL_TRANSPORT: "unsupported-fixture-transport" }
  ]) {
    const result = run({ ...gateway, ...overrides });
    assert.equal(result.status, 1);
    assert.deepEqual(missingLabels(result), ["AUTH_MAIL"]);
  }
});

test("SMTP validation retains host, port, user and sender requirements", () => {
  for (const overrides of [
    { AUTH_SMTP_HOST: "bad host" }, { AUTH_SMTP_HOST: "smtp.qq.com:465" },
    { AUTH_SMTP_PORT: "0" }, { AUTH_SMTP_PORT: "65536" }, { AUTH_SMTP_PORT: "1.5" },
    { AUTH_SMTP_USER: "" }, { AUTH_MAIL_FROM: "" },
    { AUTH_MAIL_FROM: "sender@example.invalid\r\nBcc: injected@example.invalid" }
  ]) {
    const result = run(overrides);
    assert.equal(result.status, 1);
    assert.deepEqual(missingLabels(result), ["AUTH_MAIL"]);
  }
});

test("Neon helper-derived direct URL is ready without claiming network proof", () => {
  const result = run();
  const direct = result.checks.DATABASE_URL_UNPOOLED;
  assert.equal(direct.status, "ready");
  assert.match(direct.detail, /direct Neon migration URL is derived/);
  assert.match(direct.next, /db:smoke separately/);
  assert.match(direct.next, /only checks configuration/);
});

test("explicit direct, ordinary direct, and unhandled pooled configurations", () => {
  const explicit = run({ DATABASE_URL_UNPOOLED: "postgresql://user:password@direct.example.invalid/fixture" });
  assert.equal(explicit.checks.DATABASE_URL_UNPOOLED.status, "ready");
  assert.match(explicit.checks.DATABASE_URL_UNPOOLED.detail, /configured for Prisma migrations/);
  const direct = run({ DATABASE_URL: "postgresql://user:password@db.example.invalid/fixture" });
  assert.equal(direct.checks.DATABASE_URL_UNPOOLED.status, "ready");
  const pooled = run({ DATABASE_URL: "postgresql://user:password@db-pooler.example.invalid/fixture" });
  assert.equal(pooled.status, 0, "migration warning must remain nonblocking");
  assert.equal(pooled.checks.DATABASE_URL_UNPOOLED.status, "warning");
});

test("invalid database URLs produce fixed diagnostics without parser exceptions", () => {
  const first = run({ DATABASE_URL: "invalid-fixture-db-one" });
  const second = run({ DATABASE_URL_UNPOOLED: "https://fixture-user:fixture-password@db.example.invalid" });
  assert.equal(first.checks.DATABASE_URL_UNPOOLED.status, "warning");
  assert.deepEqual(first.checks.DATABASE_URL_UNPOOLED, second.checks.DATABASE_URL_UNPOOLED);
  assert.ok(!first.output.includes("TypeError"));
  const missing = run({ DATABASE_URL: "" });
  assert.equal(missing.status, 1);
  assert.deepEqual(missingLabels(missing), ["DATABASE_URL"]);
});

test("invalid auth diagnostics are fixed regardless of supplied values", () => {
  const first = run({ AUTH_APP_URL: "bad-app-one", ...gateway, AUTH_MAIL_API_URL: "bad-gateway-one" });
  const second = run({ AUTH_APP_URL: "bad-app-two", ...gateway, AUTH_MAIL_API_URL: "bad-gateway-two" });
  assert.equal(first.output, second.output);
  assert.ok(!first.output.includes("TypeError"));
});

test("strict secret length thresholds remain enforced", () => {
  for (const key of ["USER_KEY_VAULT_SECRET", "SESSION_COOKIE_SECRET", "PROACTIVE_CRON_SECRET"]) {
    const result = run({ [key]: "fixture-short-secret" });
    assert.equal(result.status, 1);
    assert.equal(result.checks[key].status, "warning");
    assert.match(result.stderr, /production configuration has warnings/);
  }
});
