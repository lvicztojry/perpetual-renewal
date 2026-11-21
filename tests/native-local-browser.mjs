import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";

const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
const qaPort = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const base = `http://127.0.0.1:${qaPort}`;
let modelRequests = 0;
const modelServer = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "authorization,content-type");
  if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
  assert.equal(request.headers.authorization, "Bearer " + "fixture-local-personal-key");
  modelRequests++;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(request.url.endsWith("/models") ? { data: [{ id: "fixture-model" }] } : { choices: [{ message: { role: "assistant", content: "本机假供应商连接成功。" } }], usage: { prompt_tokens: 3, completion_tokens: 5 } }));
});
await new Promise(resolve => modelServer.listen(0, "127.0.0.1", resolve));
const modelBase = `http://127.0.0.1:${modelServer.address().port}/v1`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(qaPort)], {
  cwd: fileURLToPath(new URL("../native/", import.meta.url)),
  env: { ...process.env, NATIVE_BROWSER_TEST: "1" }, stdio: "ignore", windowsHide: true
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* Wait for this QA server. */ }
    await delay(250);
  }
  assert(ready, "native browser QA server must start");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await page.getByLabel("邮箱标识").fill("native-a@example.test");
  await page.getByLabel("密码", { exact: true }).fill("fixture-local-password-a");
  await page.locator("form button").click();
  await page.getByLabel("恢复码").waitFor();
  const recovery = await page.getByLabel("恢复码").inputValue();
  assert(recovery.length > 40);
  await page.getByRole("button", { name: "我已保存，进入应用" }).click();
  await page.getByRole("button", { name: "锁定", exact: true }).waitFor();
  const api = (path, method = "GET", body) => page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
  assert.equal((await api("/api/companions")).status, 200);
  assert.equal((await api("/api/sync/inbox")).status, 200);
  const created = await api("/api/companions", "POST", { name: "本地人物", relationshipKind: "FRIEND", personality: ["自然"], speakingStyle: "自然简短", background: "用于隔离测试", boundaries: "尊重用户", userAddress: "你", companionAddress: "我", immersionEnabled: true, proactiveMessagesEnabled: false });
  assert.equal(created.status, 201, JSON.stringify(created));
  const companion = created.body.companion;
  assert(companion.id && companion.conversationId);
  const sent = await api(`/api/conversations/${companion.conversationId}/messages`, "POST", { content: "你好，这是本地持久化测试", clientMessageId: "native-fixture-message" });
  assert.equal(sent.status, 201, JSON.stringify(sent));
  const groups = await api("/api/groups", "POST", { name: "本地群聊", background: "隔离群", companionIds: [companion.id] });
  assert.equal(groups.status, 200, JSON.stringify(groups));
  const groupId = groups.body.group.id;
  assert.equal((await api("/api/local/groups/run", "POST")).body.checked, 1);
  const groupMessage = await api(`/api/groups/${groupId}`, "POST", { action: "message", content: "大家好", clientId: "native-fixture-group" });
  assert.equal(groupMessage.status, 200, JSON.stringify(groupMessage));
  const dream = await api(`/api/companions/${companion.id}/dream`, "POST", { action: "start" });
  assert.equal(dream.status, 200, JSON.stringify(dream));
  const credential = await api("/api/me/llm-credential", "PUT", { provider: "compatible", apiKey: "fixture-local-personal-key", baseUrl: modelBase, model: "fixture-model" });
  assert.equal(credential.status, 200, JSON.stringify(credential));
  await page.reload();
  await page.getByLabel("邮箱标识").fill("native-a@example.test");
  await page.getByLabel("密码", { exact: true }).fill("fixture-local-password-a");
  await page.locator("form button").click();
  await page.getByRole("button", { name: "锁定", exact: true }).waitFor();
  assert((await api("/api/companions")).body.companions.some(person => person.id === companion.id));
  assert.equal((await api("/api/me/llm-credential")).body.credential.configured, true);
  assert.equal((await api(`/api/groups/${groupId}`)).status, 200);
  assert.equal((await api(`/api/companions/${companion.id}/dream`)).status, 200);
  assert.equal((await api("/api/me/export")).status, 200);
  const storage = await page.evaluate(async () => {
    const { readDocument } = await import("/src/runtime/database.ts");
    return JSON.stringify(await readDocument());
  });
  for (const privateValue of ["fixture-local-personal-key", "你好，这是本地持久化测试", "fixture-local-password-a"]) assert(!storage.includes(privateValue), "persisted document must be encrypted");
  await page.getByRole("button", { name: "锁定", exact: true }).click();
  await page.getByRole("button", { name: "忘记密码", exact: true }).click();
  await page.getByLabel("邮箱标识").fill("native-a@example.test");
  await page.getByLabel("恢复码").fill(recovery);
  await page.getByLabel("新密码").fill("fixture-local-new-password-a");
  await page.locator("form button").click();
  await page.getByText("密码已更新，请使用新密码解锁原数据。").waitFor();
  await page.getByLabel("密码", { exact: true }).fill("fixture-local-new-password-a");
  await page.locator("form button").click();
  await page.getByRole("button", { name: "锁定", exact: true }).waitFor();
  assert.equal((await api("/api/me/llm-credential")).body.credential.configured, true, "recovery must preserve encrypted credentials");
  const connection = await api("/api/me/llm-test", "POST", {});
  assert.equal(connection.status, 200, JSON.stringify(connection));
  assert.equal(connection.body.ok, true, JSON.stringify(connection));
  assert(modelRequests > 0, "recovered vault must actually decrypt the original Key for the provider");
  assert((await api("/api/companions")).body.companions.some(person => person.id === companion.id));
  await page.getByRole("button", { name: "锁定", exact: true }).click();
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await page.getByLabel("邮箱标识").fill("native-b@example.test");
  await page.getByLabel("密码", { exact: true }).fill("fixture-local-password-b");
  await page.locator("form button").click();
  await page.getByRole("button", { name: "我已保存，进入应用" }).click();
  await page.getByRole("button", { name: "锁定", exact: true }).waitFor();
  assert.equal((await api("/api/companions")).body.companions.length, 0);
  assert.equal((await api("/api/me/llm-credential")).body.credential.configured, false);
  assert.equal((await api(`/api/groups/${groupId}`)).status, 404);
  const settingsCalls = await page.evaluate(async () => {
    const original = window.fetch;
    let calls = 0;
    window.fetch = (...args) => { if (String(args[0]).startsWith("/api/")) calls++; return original(...args); };
    location.hash = "/settings";
    await new Promise(resolve => setTimeout(resolve, 600));
    window.fetch = original;
    return calls;
  });
  assert(settingsCalls < 20, "settings must not refetch continuously on each render");
  assert(await page.getByRole("textbox").count() > 0, "original settings form should render");
  await page.evaluate(() => { location.hash = "/story"; });
  await page.getByRole("heading", { name: "从一个想见的人开始" }).waitFor();
  await page.evaluate(() => { location.hash = "/"; });
  await page.getByRole("button", { name: "锁定", exact: true }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL("../.tmp-native-qa/native-local-mobile.png", import.meta.url)) });
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.screenshot({ path: fileURLToPath(new URL("../.tmp-native-qa/native-local-desktop.png", import.meta.url)) });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Native browser QA passed: original UI, local password/recovery, encrypted restart persistence, private chat, groups, dream, vault preservation and account isolation. Native devices/SQLite bridge are separate checks.");
} finally {
  await browser?.close();
  server.kill();
  await new Promise(resolve => modelServer.close(resolve));
}
