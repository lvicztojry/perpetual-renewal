import { expect, test, type Page } from "./fixtures";

async function signIn(page: Page) {
  const email = `account-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@perpetual-renewal.local`;
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("昵称").fill("阿续");
  await page.getByRole("button", { name: "进入", exact: true }).click();
  await expect(page).toHaveURL("/");
  return email;
}

test("signed-in sidebar opens a persistent responsive personal account without a login link", async ({ page }) => {
  const email = await signIn(page);
  await expect(page.getByRole("link", { name: "登录", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "我的账号", exact: true })).toBeVisible();
  expect((await page.request.patch("/api/me", { data: { proactiveMessagesEnabled: false } })).ok()).toBe(true);
  await page.getByRole("link", { name: "我的账号", exact: true }).click();
  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("heading", { name: "我的账号", exact: true })).toBeVisible();
  await expect(page.getByLabel("账号概览").getByText(email, { exact: true })).toBeVisible();
  await page.getByLabel("昵称", { exact: true }).fill("晚风");
  await page.getByLabel("时区", { exact: true }).fill("Asia/Singapore");
  await page.getByRole("button", { name: "保存个人资料", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("个人资料已保存。");
  const saved = (await (await page.request.get("/api/me")).json()).user;
  expect(saved.nickname).toBe("晚风");
  expect(saved.timezone).toBe("Asia/Singapore");
  expect(saved.proactiveMessagesEnabled).toBe(false);
  await page.reload();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("晚风");
  await page.screenshot({ path: "design/previews/2026-11-02/account-desktop-implemented.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("昵称", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "design/previews/2026-11-02/account-mobile-implemented.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole("link", { name: "管理我的数据", exact: true })).toHaveAttribute("href", "/settings#account-privacy");
  await page.getByRole("link", { name: "返回聊天", exact: true }).click();
  await expect(page.getByRole("link", { name: "我的账号", exact: true })).toBeVisible();
});

test("personal account resets through its own mailbox, retries safely and logs out", async ({ page }) => {
  const email = await signIn(page);
  await page.goto("/account");
  let attempts = 0;
  await page.route("**/api/auth/forgot-password", (route) => {
    expect(route.request().postDataJSON()).toEqual({ email });
    attempts += 1;
    return route.fulfill(attempts === 1 ? { status: 503, json: { error: "private-provider-diagnostic" } } : { json: {} });
  });
  await page.getByRole("button", { name: "发送密码重置邮件", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("重置邮件暂未发送，请稍后重试。");
  await expect(page.getByText("private-provider-diagnostic")).toHaveCount(0);
  await page.getByRole("button", { name: "发送密码重置邮件", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("你会收到密码重置邮件");
  expect(attempts).toBe(2);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/account");
  await expect(page).toHaveURL("/login");
});

test("personal account requires a session and never shows another user's profile", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "我的账号", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("邮箱")).toBeVisible();
});
