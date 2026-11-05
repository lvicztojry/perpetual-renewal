import { expect, test, type Page } from "./fixtures";

async function loginWithCompanion(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`proactive-state-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("回响状态测试");
  await page.getByRole("button", { name: "进入", exact: true }).click();
  await expect(page).toHaveURL("/");
  const response = await page.request.post("/api/companions", { data: { name: "知更", relationshipKind: "FRIEND", speakingStyle: "自然简短", proactiveMessagesEnabled: true, proactiveFrequencyMinutes: 1, proactiveFrequencyPreset: "1m" } });
  expect(response.ok()).toBe(true);
  return (await response.json()).companion;
}

test("proactive panel explains an account pause and only enables it after an explicit click", async ({ page }) => {
  await page.clock.install();
  await loginWithCompanion(page);
  expect((await page.request.patch("/api/me", { data: { proactiveMessagesEnabled: false, proactiveFrequencyHours: 12 } })).ok()).toBe(true);
  let posts = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/proactive-drafts")) posts++; });
  await page.goto("/");
  await page.getByRole("button", { name: "主动回响", exact: true }).click();
  const state = page.getByRole("region", { name: "自动发送状态" });
  await expect(state).toContainText("账号总开关：已关闭 · 此人物：已开启");
  await expect(state).toContainText("所有人物都不会主动发消息");
  await expect(page.getByRole("button", { name: "手动生成草稿", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog")).not.toContainText("下次检查约");
  await expect(page.getByRole("dialog")).toContainText("关闭页面或切换人物");
  await page.clock.runFor(120_100);
  expect(posts).toBe(0);
  expect((await (await page.request.get("/api/me")).json()).user.proactiveMessagesEnabled).toBe(false);
  await page.screenshot({ path: "design/previews/2026-11-02/proactive-paused-implemented.png", fullPage: true });
  await page.getByRole("button", { name: "开启账号主动回响", exact: true }).click();
  await expect(state).toContainText("已开启：到期后直接送达聊天");
  const profile = (await (await page.request.get("/api/me")).json()).user;
  expect(profile.proactiveMessagesEnabled).toBe(true);
  expect(profile.proactiveFrequencyHours).toBe(12);
  await expect(page.getByRole("button", { name: "按当前设置检查一次" })).toBeEnabled();
  expect(posts).toBe(0);
});

test("opening proactive history is read-only and manual drafts are clearly separate from automatic delivery", async ({ page }) => {
  const companion = await loginWithCompanion(page);
  const generated = await page.request.post(`/api/companions/${companion.id}/proactive-drafts`, { data: { force: true, maxDrafts: 1 } });
  expect(generated.ok()).toBe(true);
  const draft = (await generated.json()).data[0];
  expect(draft).toBeTruthy();
  let posts = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/proactive-drafts")) posts++; });
  await page.goto("/");
  await page.getByRole("button", { name: "主动回响", exact: true }).click();
  await expect(page.getByRole("heading", { name: "回响记录与草稿" })).toBeVisible();
  await expect(page.getByText(draft.content, { exact: true })).toBeVisible();
  await page.getByText("查看这条回响的生成信息", { exact: true }).first().click();
  await expect(page.getByRole("dialog")).toContainText("演示模板");
  await expect(page.getByRole("dialog")).toContainText("手动草稿不会自行发送");
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "刷新主动回响状态" }).click();
  expect(posts).toBe(0);
  const requestPromise = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/proactive-drafts"));
  await page.getByRole("button", { name: "手动生成草稿", exact: true }).click();
  expect((await requestPromise).postDataJSON().force).toBe(true);
  await expect(page.getByRole("button", { name: "按当前设置检查一次" })).toBeEnabled();
  const checkPromise = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/proactive-drafts"));
  await page.getByRole("button", { name: "按当前设置检查一次" }).click();
  expect((await checkPromise).postDataJSON().force).toBe(false);
  await expect(page.getByRole("dialog")).toContainText("尚未到达主动回响候选时间");
  const saved = (await (await page.request.get(`/api/companions/${companion.id}/proactive-drafts`)).json()).data;
  expect(saved.every((item: { status: string }) => item.status === "draft")).toBe(true);
  const beforeMessages = await page.locator(".message-bubble").count();
  const failure = "本轮回响内容重复或不合适，已跳过发送，稍后再试。";
  await page.route("**/api/companions/*/proactive-drafts", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ json: { data: [], status: "unavailable", skippedReason: failure,
      deliveredCount: 0, deliveredMessages: [], savedCount: 0 } });
  });
  await page.getByRole("button", { name: "手动生成草稿", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(failure);
  await expect(page.locator(".message-bubble")).toHaveCount(beforeMessages);
  const unchanged = (await (await page.request.get(`/api/companions/${companion.id}/proactive-drafts`)).json()).data;
  expect(unchanged.length).toBe(saved.length);
});
