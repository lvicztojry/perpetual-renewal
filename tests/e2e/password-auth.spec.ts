import { expect, test, type Page, type Request } from "@playwright/test";

const email = "member@example.test";
const password = "a distinct long password";
const token = "test_mail_token_0123456789abcdefghijklmnopqrstuvwxyz";

test.beforeEach(async ({ page }) => {
  // Every auth request is mocked, including unexpected endpoints. These tests
  // never create accounts, send mail, or need a database / mail provider.
  await page.route("**/api/auth/**", (route) => route.fulfill({
    status: 503,
    json: { error: "测试未配置此接口。" }
  }));
});

function observeAuth(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/auth/")) requests.push(request);
  });
  return requests;
}

async function openPasswordLogin(page: Page) {
  // This only selects password UI. It cannot enable the server's local-email mode.
  await page.goto("/login?mode=password");
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveCount(0);
}

test("password login validates, reveals accessibly, blocks duplicates and retries", async ({ page }) => {
  const requests = observeAuth(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/login", async (route) => {
    await gate;
    await route.fulfill({ status: 401, json: { error: "邮箱或密码不正确。" } });
  });
  await openPasswordLogin(page);
  const submit = page.getByRole("button", { name: "登录", exact: true });
  const passwordInput = page.getByLabel("密码", { exact: true });
  await submit.click();
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("邮箱", { exact: true })).toBeFocused();
  await expect(passwordInput).toHaveAttribute("aria-invalid", "true");
  expect(requests).toHaveLength(0);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await passwordInput.fill(password);
  await expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
  await expect(passwordInput).toHaveAttribute("type", "password");
  const reveal = page.getByRole("button", { name: "显示密码", exact: true });
  await expect(reveal).toHaveAttribute("title", "显示密码");
  await reveal.click();
  await expect(passwordInput).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "隐藏密码" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "隐藏密码" }).click();
  await expect(passwordInput).toHaveAttribute("type", "password");
  await submit.click();
  await expect(page.getByRole("button", { name: "请稍候…" })).toBeDisabled();
  await expect(page.getByLabel("邮箱", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "注册账号" })).toBeDisabled();
  expect(requests).toHaveLength(1);
  expect(requests[0].method()).toBe("POST");
  expect(requests[0].postDataJSON()).toEqual({ email, password });
  release();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("邮箱或密码不正确。");
  await expect(submit).toBeEnabled();
  await expect(passwordInput).toHaveValue(password);

  // Supply a hermetic landing page too: successful UI navigation should not
  // depend on a real auth cookie, protected page, repository or session service.
  await page.route((url) => url.pathname === "/", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html><body><h1>登录完成</h1></body></html>"
  }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: { message: "登录成功。" } }));
  await submit.click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "登录完成" })).toBeVisible();
  expect(requests).toHaveLength(2);
});

test("registration validates length and confirmation then asks for email verification", async ({ page }) => {
  const requests = observeAuth(page);
  await page.route("**/api/auth/register", (route) => route.fulfill({
    json: { message: "请查收验证邮件，验证邮箱后再登录。" }
  }));
  await openPasswordLogin(page);
  await page.getByRole("button", { name: "注册账号" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill("invalid-address");
  await page.getByLabel("昵称", { exact: true }).fill("   ");
  await page.getByLabel("密码", { exact: true }).fill("too short");
  await page.getByLabel("确认密码", { exact: true }).fill("different");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByText("密码需为 12–128 个字符。")).toBeVisible();
  await expect(page.getByText("两次输入的密码不一致。")).toBeVisible();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveAttribute("aria-invalid", "true");
  expect(requests).toHaveLength(0);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("昵称", { exact: true }).fill("  测试用户  ");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("minlength", "12");
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("maxlength", "128");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("请查收验证邮件，验证邮箱后再登录。");
  expect(requests).toHaveLength(1);
  expect(requests[0].postDataJSON()).toEqual({ email, password, nickname: "测试用户" });
  await expect(page).toHaveURL("/login?mode=password");
  await page.getByRole("button", { name: "返回登录", exact: true }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("type", "password");
});

test("forgot-password validates email, retries a network failure and shows a generic outcome", async ({ page }) => {
  const requests = observeAuth(page);
  await page.route("**/api/auth/forgot-password", (route) => route.abort("failed"));
  await openPasswordLogin(page);
  await page.getByRole("button", { name: "忘记密码" }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "发送重置邮件" }).click();
  await expect(page.getByText("请输入有效的邮箱地址。")).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "发送重置邮件" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("暂时无法连接，请检查网络后重试。");
  await expect(page.getByRole("button", { name: "发送重置邮件" })).toBeEnabled();
  await page.route("**/api/auth/forgot-password", (route) => route.fulfill({ json: {} }));
  await page.getByRole("button", { name: "发送重置邮件" }).click();
  await expect(page.getByRole("status")).toHaveText(/如果此邮箱已注册/);
  expect(requests).toHaveLength(2);
  expect(requests[1].postDataJSON()).toEqual({ email });
  await page.getByRole("button", { name: "返回登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
});

test("mode changes clear password drafts, reveal state and validation errors", async ({ page }) => {
  await openPasswordLogin(page);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("请输入有效的邮箱地址。")).toBeVisible();
  await page.getByRole("button", { name: "注册账号" }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByText("请输入有效的邮箱地址。")).toHaveCount(0);
  await page.getByRole("button", { name: "返回登录", exact: true }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
});

test("invalid server JSON can be retried without exposing its body", async ({ page }) => {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    status: 502,
    contentType: "text/html",
    body: "<html>private-upstream-debug-value</html>"
  }));
  await openPasswordLogin(page);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("服务暂时不可用，请稍后重试。");
  await expect(page.getByText("private-upstream-debug-value")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
});

for (const purpose of ["reset", "verify"] as const) {
  const path = purpose === "reset" ? "/reset-password" : "/verify-email";
  const action = purpose === "reset" ? "重置密码" : "验证邮箱";

  test(`${purpose} consumes a fragment only on submit, hides it and retries API errors`, async ({ page }) => {
    const requests = observeAuth(page);
    const allRequests: Request[] = [];
    page.on("request", (request) => allRequests.push(request));
    let attempts = 0;
    await page.route(`**/api/auth/${purpose === "reset" ? "reset-password" : "verify-email"}`, (route) => {
      attempts += 1;
      return route.fulfill(attempts === 1
        ? { status: 410, json: { error: "链接已失效，请重新申请。" } }
        : { json: {} });
    });
    await page.goto(`${path}#token=${token}`);
    const submit = page.getByRole("button", { name: action, exact: true });
    await expect(submit).toBeEnabled();
    await expect(page).toHaveURL(path);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    expect(requests).toHaveLength(0);
    if (purpose === "reset") {
      await page.getByLabel("新密码", { exact: true }).fill("short");
      await page.getByLabel("确认密码", { exact: true }).fill("different");
      await submit.click();
      await expect(page.getByText("密码需为 12–128 个字符。")).toBeVisible();
      expect(requests).toHaveLength(0);
      await page.getByLabel("新密码", { exact: true }).fill(password);
      await page.getByLabel("确认密码", { exact: true }).fill(password);
    }
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("链接已失效，请重新申请。");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("status")).toHaveText(purpose === "reset"
      ? "密码已重置，请使用新密码登录。" : "邮箱已验证，请使用邮箱和密码登录。");
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.method()).toBe("POST");
      expect(request.postDataJSON()).toEqual(purpose === "reset" ? { token, password } : { token });
      expect(request.headers()["referer"]).toBeUndefined();
    }
    for (const request of allRequests) {
      expect(request.url()).not.toContain(token);
      expect(request.headers()["referer"] ?? "").not.toContain(token);
    }
    expect(await page.evaluate(() => ({ ...localStorage, ...sessionStorage }))).toEqual({});
    await page.getByRole("link", { name: "使用密码登录", exact: true }).click();
    await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
  });

  for (const { name, suffix } of [
    { name: "missing", suffix: "" },
    { name: "malformed", suffix: "#token=bad" },
    { name: "duplicate", suffix: `#token=${token}&token=${token}` },
    { name: "query", suffix: `?token=${token}` }
  ]) {
    test(`${purpose} rejects ${name} token without submitting`, async ({ page }) => {
      const requests = observeAuth(page);
      await page.goto(`${path}${suffix}`);
      await expect(page.getByRole("main").getByRole("alert")).toContainText("链接无效或已失效");
      await expect(page).toHaveURL(path);
      await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
      expect(requests).toHaveLength(0);
    });
  }
}

test("password forms remain usable at 320px with visible password controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openPasswordLogin(page);
  await page.getByRole("button", { name: "注册账号" }).click();
  await page.getByLabel("密码", { exact: true }).fill(password);
  await expect(page.getByRole("button", { name: "显示密码", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
