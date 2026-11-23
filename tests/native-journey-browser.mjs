import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Browser-only IndexedDB adapter. This does not validate Tauri, SQLite, or APKs.
const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: fileURLToPath(new URL("../native/", import.meta.url)),
  env: { ...process.env, NATIVE_BROWSER_TEST: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true
});
let serverLog = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { serverLog = (serverLog + chunk).slice(-6000); });
let browser;
let page;
const errors = [];
const password = "journey-local-fixture-password";

async function api(page, path, method = "GET", body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    }) });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}

async function journey(page) {
  const result = await api(page, "/api/me/journey");
  assert.equal(result.status, 200);
  return result.body;
}

async function register(page, email) {
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await page.getByLabel("邮箱标识").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.locator("form button").click();
  const recovery = page.getByLabel("恢复码", { exact: true });
  await expect(recovery).toBeVisible();
  assert((await recovery.inputValue()).length > 40);
  // No onboarding may obscure the only copy of the recovery code.
  await expect(page.locator("[data-journey-dialog][open]")).toHaveCount(0);
  await page.getByRole("button", { name: "我已保存，进入应用", exact: true }).click();
  await page.getByRole("button", { name: "锁定", exact: true }).waitFor();
  await expect(page.locator(".local-content")).toHaveCount(1);
  return journey(page);
}

async function unlock(page, email) {
  await page.getByLabel("邮箱标识").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.locator("form button").click();
  await page.getByRole("button", { name: "锁定", exact: true }).waitFor();
  await expect(page.locator(".local-content")).toHaveCount(1);
}

async function lock(page) {
  await page.getByRole("button", { name: "锁定", exact: true }).click();
  await page.getByLabel("邮箱标识").waitFor();
  await expect(page.locator(".local-content")).toHaveCount(0);
}

try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* Our own isolated server. */ }
    await delay(250);
  }
  assert(ready, "isolated native Vite server must start");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const external = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== base) {
      external.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
  await context.addInitScript(() => sessionStorage.setItem("renewal:intro-seen:v1", "1"));
  page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("dialog", { name: "更新公告", exact: true }).waitFor();
  await page.getByRole("button", { name: "我知道了", exact: true }).click();
  const a = await register(page, "journey-a@example.test");
  assert.deepEqual(a.journey, { version: 1, status: "active", step: "awakening", companionId: null, revision: 0 });

  // UI assertions below use the shared guide's semantic controls.
  const guide = page.locator("[data-journey-dialog]");
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("heading")).toHaveText("初醒 · 有人等你");
  await guide.getByRole("button", { name: "暂时不想说", exact: true }).click();
  await guide.getByRole("button", { name: "随她走进旧城", exact: true }).click();
  await expect(guide.getByRole("heading")).toHaveText("旧城 · 久别重逢");
  await guide.getByRole("button", { name: "暂歇片刻", exact: true }).click();
  await expect(guide).toBeHidden();
  const paused = await journey(page);
  assert.equal(paused.journey.status, "paused");
  assert.equal(paused.journey.step, "arrival");
  await page.reload();
  await unlock(page, "journey-a@example.test");
  assert.deepEqual(await journey(page), paused);
  await expect(guide).toBeHidden();
  await page.getByRole("button", { name: "找余念安", exact: true }).first().click();
  await guide.getByRole("button", { name: "接着走", exact: true }).click();
  await expect(guide.getByRole("heading")).toHaveText("旧城 · 久别重逢");
  assert.equal((await journey(page)).journey.status, "active");
  await guide.getByRole("button", { name: "暂歇片刻", exact: true }).click();
  await expect(guide).toBeHidden();
  const savedA = await journey(page);
  await lock(page);

  const b = await register(page, "journey-b@example.test");
  assert.notEqual(b.userId, a.userId);
  assert.equal(b.journey.step, "awakening");
  assert.equal(b.journey.revision, 0);
  await expect(guide.getByRole("heading")).toHaveText("初醒 · 有人等你");
  await guide.getByRole("button", { name: "我想自行走走", exact: true }).click();
  await expect(guide).toBeHidden();
  assert.equal((await journey(page)).journey.status, "skipped");
  await lock(page);
  await unlock(page, "journey-a@example.test");
  assert.deepEqual(await journey(page), savedA);
  await expect(guide).toBeHidden();

  // Emulate a pre-journey encrypted snapshot by omitting only its new field.
  // Persist through the real account encryption path, then unlock from disk.
  const created = await api(page, "/api/companions", "POST", {
    name: "旧快照人物", relationshipKind: "FRIEND", speakingStyle: "简短自然", proactiveMessagesEnabled: false
  });
  assert.equal(created.status, 201);
  const originalPeople = await api(page, "/api/companions");
  await page.evaluate(async () => {
    const { decode, encode, hydrate, snapshot } = await import("/src/runtime/codec.ts");
    const { exclusive, persistActiveState } = await import("/src/runtime/account.ts");
    await exclusive(async () => {
      const state = decode(snapshot());
      delete state.renewalJourneyStore;
      hydrate(encode(state));
      await persistActiveState();
    });
  });
  await page.reload();
  await unlock(page, "journey-a@example.test");
  const legacy = await journey(page);
  assert.equal(legacy.journey.status, "legacy");
  assert.equal(legacy.journey.revision, 0);
  await expect(guide).toBeHidden();
  assert.deepEqual(await api(page, "/api/companions"), originalPeople);
  await page.getByRole("button", { name: "找余念安", exact: true }).first().click();
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "重返初醒", exact: true }).click();
  await guide.getByRole("button", { name: "我想自行走走", exact: true }).click();
  await expect(guide).toBeHidden();
  assert.deepEqual(await api(page, "/api/companions"), originalPeople);
  assert.deepEqual(external, [], "onboarding must never contact a model or mail service");
  assert.deepEqual(errors, [], "native browser must have no uncaught page errors");
  console.log("Native journey browser QA passed: recovery acknowledgement, new registration, pause/reload/unlock, resume, account isolation, old encrypted snapshot and non-destructive replay. Native platform validation is separate.");
} catch (error) {
  console.error("Isolated Native Journey Vite diagnostics:\n" + serverLog);
  console.error("Browser diagnostics:", { errors, text: await page?.locator("body").innerText({ timeout: 2000 }).catch(() => "unavailable") });
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
