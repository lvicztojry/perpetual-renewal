import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";

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
  if (request.url.endsWith("/audio/transcriptions")) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("latin1");
    assert(body.includes("fixture-stt"), "recorded audio uses a dedicated transcription model");
    assert(body.includes('name="file"; filename='), "recorded audio file must be forwarded");
    response.end(JSON.stringify({ text: "这是录音转写的文字" }));
    return;
  }
  response.end(JSON.stringify(request.url.endsWith("/models") ? { data: [{ id: "fixture-model" }] } : { choices: [{ message: { role: "assistant", content: "本机假供应商连接成功。" } }], usage: { prompt_tokens: 3, completion_tokens: 5 } }));
});
await new Promise(resolve => modelServer.listen(0, "127.0.0.1", resolve));
const modelBase = `http://127.0.0.1:${modelServer.address().port}/v1`;
let serverLog = "";
// The HTML response alone is not readiness: main.tsx dynamically imports start.tsx.
// Release optimized dependencies without waiting for the first browser crawl to
// end, so a late import cannot hold bootstrap behind the optimizer's crawl gate.
// Keep this test-specific setting out of native dev/build configuration.
const viteBootstrap = `
  import { createServer } from "vite";
  const server = await createServer({
    optimizeDeps: { holdUntilCrawlEnd: false },
    server: { host: "127.0.0.1", port: ${qaPort}, strictPort: true }
  });
  await server.listen();
  server.printUrls();
`;
const server = spawn(process.execPath, ["--input-type=module", "--eval", viteBootstrap], {
  cwd: fileURLToPath(new URL("../native/", import.meta.url)),
  env: { ...process.env, NATIVE_BROWSER_TEST: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true
});
for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { serverLog = (serverLog + chunk).slice(-64000); });
let spawnError;
server.on("error", error => { spawnError = error; });
const serverExited = new Promise(resolve => server.once("exit", resolve));
let browser;
let diagnosticPage;
const bootstrapFailures = [];
const pendingRequests = new Set();
const errors = [];
let phase = "dev-server startup";
try {
  let ready = false;
  const deadline = Date.now() + 30000;
  for (let i = 0; i < 80; i++) {
    if (spawnError) throw spawnError;
    assert.equal(server.exitCode, null, `native Vite exited during startup:\n${serverLog}`);
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Wait for this QA server. */ }
    if (Date.now() >= deadline) break;
    await delay(250);
  }
  assert(ready, `native browser QA server must start:\n${serverLog}`);
  phase = "bootstrap module transforms";
  for (const path of ["/src/main.tsx", "/src/start.tsx"]) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, `${path} must transform successfully: ${await response.text()}`);
  }
  phase = "browser bootstrap";
  browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  diagnosticPage = page;
  page.on("request", request => pendingRequests.add(new URL(request.url()).pathname));
  page.on("requestfinished", request => pendingRequests.delete(new URL(request.url()).pathname));
  page.on("requestfailed", request => {
    const url = new URL(request.url());
    if (url.origin === base) bootstrapFailures.push({ path: url.pathname, error: request.failure()?.errorText });
  });
  await context.addInitScript(() => sessionStorage.setItem("renewal:journey-suppress:v1", "1"));
  page.setDefaultTimeout(90000);
  await page.addLocatorHandler(page.getByRole("button", { name: "跳过开场动画", exact: true }), async button => { await button.click(); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  const announcement = page.getByRole("dialog", { name: "更新公告", exact: true });
  await announcement.waitFor();
  phase = "local account and persistence checks";
  await page.getByRole("button", { name: "我知道了", exact: true }).click();
  await page.reload();
  await page.getByLabel("邮箱标识").waitFor();
  assert(!await announcement.isVisible(), "restarting the same version must not auto-open the announcement");
  await page.getByRole("button", { name: "消息与更新公告", exact: true }).click();
  await announcement.waitFor();
  await page.keyboard.press("Escape");
  assert(!await announcement.isVisible(), "Escape closes the announcement");
  await page.evaluate(() => localStorage.setItem("renewal.release-notice.seen", "0.1.1"));
  await page.reload();
  await announcement.waitFor();
  await page.getByRole("button", { name: "关闭更新公告", exact: true }).click();
  await page.reload();
  await page.getByLabel("邮箱标识").waitFor();
  assert(!await announcement.isVisible(), "an upgrade announcement must only auto-open once");
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await page.getByLabel("邮箱标识").fill("native-a@example.test");
  await page.getByLabel("密码", { exact: true }).fill("fixture-local-password-a");
  await page.locator("form button").click();
  await page.getByLabel("恢复码").waitFor();
  const recovery = await page.getByLabel("恢复码").inputValue();
  assert(recovery.length > 40);
  await page.getByRole("button", { name: "我已保存，进入应用" }).click();
  await page.getByRole("button", { name: "锁定", exact: true }).waitFor();
  assert(!await announcement.isVisible(), "signing in must not repeat the announcement");
  const skipIntro = page.getByRole("button", { name: "跳过开场动画", exact: true });
  if (await skipIntro.isVisible()) await skipIntro.click();
  await page.getByRole("button", { name: "消息与更新公告", exact: true }).click();
  await announcement.waitFor();
  await page.getByRole("button", { name: "关闭更新公告", exact: true }).click();
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
  await page.evaluate(() => { location.hash = "/"; });
  await page.locator(".relationship-button").filter({ hasText: "本地人物" }).click();
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 740 });
    for (const name of ["入梦", "编辑关系设定", "主动回响"]) {
      const control = page.getByRole(name === "入梦" ? "link" : "button", { name, exact: true });
      const bounds = await control.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 38 && bounds.y + bounds.height < 740, `${name} must fit on a ${width}px phone screen`);
      assert(await control.locator("span").isVisible(), `${name} needs a visible text label`);
    }
    for (const name of ["朗读最近回复", "供应商转写（上传录音）"]) {
      const button = page.getByRole("button", { name, exact: true });
      assert(await button.isVisible(), name + " needs a visible text button in the mobile conversation");
      const bounds = await button.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 38 && bounds.y + bounds.height <= 740, name + " must fit on the phone");
    }
  }
  await page.screenshot({ path: fileURLToPath(new URL("../.tmp-native-qa/native-private-tools.png", import.meta.url)) });
  await page.getByText("语音输入设置", { exact: true }).click();
  phase = "MediaRecorder provider transcription and preview";
  await page.getByLabel("话筒识别方式").selectOption("provider");
  await page.getByLabel("语音转写模型").fill("fixture-stt");
  await page.getByText("语音输入设置", { exact: true }).click();
  await page.getByRole("textbox", { name: "把想说的话放在这里" }).fill("保留原草稿");
  await page.getByRole("button", { name: "语音输入", exact: true }).click();
  await page.getByRole("button", { name: "停止录音", exact: true }).waitFor();
  await delay(1100);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="把想说的话放在这里"]')?.value === "保留原草稿 这是录音转写的文字");
  assert(await page.getByLabel("录音预听").isVisible(), "recorded clip remains available for local playback");
  await page.getByRole("button", { name: "清除预听", exact: true }).click();
  assert(!await page.getByLabel("录音预听").count());
  console.log("Native recording UI passed: MediaRecorder upload, dedicated STT model, draft append, local preview and preview cleanup.");
  phase = "recovery and account isolation checks";
  await page.getByRole("button", { name: "主动回响", exact: true }).click();
  await page.getByRole("button", { name: "设置此人物的主动回响开关与频率" }).click();
  await page.getByRole("group", { name: "主动回响开关", exact: true }).scrollIntoViewIfNeeded();
  assert(await page.getByRole("group", { name: "主动回响开关", exact: true }).isVisible());
  assert(await page.getByRole("group", { name: "主动回响节奏", exact: true }).isVisible());
  await page.getByRole("button", { name: "关闭关系资料", exact: true }).click();
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
} catch (error) {
  const directory = fileURLToPath(new URL("../.tmp-native-qa/", import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(directory + "/browser-failure.json", JSON.stringify({ phase, error: String(error), bootstrapFailures, pendingRequests: [...pendingRequests], errors, serverLog }, null, 2));
  await diagnosticPage?.screenshot({ path: directory + "/browser-failure.png", timeout: 5000 }).catch(() => undefined);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
  await serverExited;
  await new Promise(resolve => modelServer.close(resolve));
}
