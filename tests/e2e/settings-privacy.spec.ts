import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const E2E_SESSION_COOKIE_SECRET =
  process.env.E2E_SESSION_COOKIE_SECRET ?? "e2e-session-cookie-secret-ui-private-32";

async function loginAsFreshUser(page: Page, prefix: string) {
  const unique = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`${unique}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("设置页 QA");
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "账号与资料" })).toBeVisible();
  await expect(page.getByText(/已就绪 \d+ 项 · 需处理 \d+ 项/)).toBeVisible();
  await expect(page.getByText("Session 签名 secret")).toBeVisible();
  await expect(page.getByText(E2E_SESSION_COOKIE_SECRET)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "模型供应商" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出数据" })).toBeEnabled();

  return unique;
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth > root.clientWidth + 1;
      })
    )
    .toBe(false);
}

test("settings saves and deletes user API key, and shows connection failure without leaking the key", async ({
  page
}) => {
  const fakeApiKey = `e2e-fake-user-key-${Date.now()}-1234`;

  await page.route("**/api/me/llm-test", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        ok: false,
        provider: "compatible",
        model: "e2e-test-model",
        credentialSource: "user-vault",
        latencyMs: 42,
        errorType: "authentication",
        error: "API Key 无效、权限不足，或供应商拒绝了这次请求。",
        retryable: false
      })
    });
  });

  await loginAsFreshUser(page, "settings-credential");

  await expect(page.getByText("未保存用户密钥，将使用服务端环境变量或 mock。")).toBeVisible();
  await page.getByLabel("Base URL").fill("https://provider.example.com/v1");
  await page.getByLabel("模型").fill("e2e-test-model");
  await page.getByLabel("API Key").fill(fakeApiKey);
  await expect(page.getByLabel("API Key")).toHaveValue(fakeApiKey);
  await expect(page.getByRole("button", { name: "保存连接配置" })).toBeEnabled();
  await page.getByRole("button", { name: "保存连接配置" }).click();

  await expect(page.getByText("已保存连接配置")).toBeVisible();
  await expect(page.getByText(/已保存 compatible\/e2e-test-model · key \.\.\.1234/)).toBeVisible();
  await expect(page.getByLabel("API Key")).toHaveValue("");
  await expect(page.getByText(fakeApiKey)).toHaveCount(0);

  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText(/连接失败 · authentication/)).toBeVisible();
  await expect(page.getByText("API Key 无效、权限不足，或供应商拒绝了这次请求。")).toBeVisible();
  await expect(page.getByText(fakeApiKey)).toHaveCount(0);

  await page.getByRole("button", { name: "删除密钥" }).click();
  await expect(page.getByText("未保存用户密钥，将使用服务端环境变量或 mock。")).toBeVisible();
  await expect(page.getByRole("button", { name: "删除密钥" })).toHaveCount(0);
});

test("settings keeps credential draft and redacts provider values after save failure", async ({
  page
}) => {
  const fakeApiKey = `e2e-save-failure-key-${Date.now()}-2468`;
  const fakeBaseUrl = "https://provider.failure.example.com/v1";
  let saveRequests = 0;

  await page.route("**/api/me/llm-credential", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }

    saveRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      status: 400,
      body: JSON.stringify({
        error: `供应商拒绝 ${fakeBaseUrl} 使用 ${fakeApiKey} 保存。`
      })
    });
  });

  await loginAsFreshUser(page, "settings-save-failure");

  await page.getByLabel("Base URL").fill(fakeBaseUrl);
  await page.getByLabel("模型").fill("e2e-save-failure-model");
  await page.getByLabel("API Key").fill(fakeApiKey);
  await page.getByRole("button", { name: "保存连接配置" }).click();

  await expect(
    page.getByText("供应商拒绝 [已隐藏 Base URL] 使用 [已隐藏 API Key] 保存。")
  ).toBeVisible();
  await expect(page.getByLabel("Base URL")).toHaveValue(fakeBaseUrl);
  await expect(page.getByLabel("模型")).toHaveValue("e2e-save-failure-model");
  await expect(page.getByLabel("API Key")).toHaveValue(fakeApiKey);
  await expect(page.getByRole("button", { name: "保存连接配置" })).toBeEnabled();
  await expect(page.getByText(fakeApiKey)).toHaveCount(0);
  await expect(page.getByText(fakeBaseUrl)).toHaveCount(0);
  expect(saveRequests).toBe(1);
});

test("settings redacts provider values after credential delete failure", async ({ page }) => {
  const fakeApiKey = `e2e-delete-failure-key-${Date.now()}-8642`;
  const fakeBaseUrl = "https://provider.delete-failure.example.com/v1";
  const fakeBearer = ["provider", "delete", "token", Date.now().toString(36), "1234567890123456"].join("-");
  let deleteRequests = 0;

  await page.route("**/api/me/llm-credential", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }

    deleteRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      status: 500,
      body: JSON.stringify({
        error: `删除失败 ${fakeBaseUrl} apiKey=${fakeApiKey} Bearer ${fakeBearer} raw payload stack at Provider.delete (provider.ts:1:2)`
      })
    });
  });

  await loginAsFreshUser(page, "settings-delete-failure");

  await page.getByLabel("Base URL").fill(fakeBaseUrl);
  await page.getByLabel("模型").fill("e2e-delete-failure-model");
  await page.getByLabel("API Key").fill(fakeApiKey);
  await page.getByRole("button", { name: "保存连接配置" }).click();
  await expect(page.getByText("已保存连接配置")).toBeVisible();

  await page.getByRole("button", { name: "删除密钥" }).click();
  await expect(page.getByText(/删除失败/)).toBeVisible();
  await expect(page.getByText("[已隐藏 Base URL]")).toBeVisible();
  await expect(page.getByText("[已隐藏敏感字段]")).toBeVisible();
  await expect(page.getByText("Bearer [已隐藏]")).toBeVisible();
  await expect(page.getByText("[已隐藏调试字段]")).toBeVisible();
  await expect(page.getByText("[已隐藏堆栈]")).toBeVisible();
  await expect(page.getByText(fakeApiKey)).toHaveCount(0);
  await expect(page.getByText(fakeBaseUrl)).toHaveCount(0);
  await expect(page.getByText(fakeBearer)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "删除密钥" })).toBeEnabled();
  expect(deleteRequests).toBe(1);
});

test("settings reads provider models and keeps API key private", async ({ page }) => {
  const fakeApiKey = `e2e-model-list-key-${Date.now()}-5678`;
  const fakeBaseUrl = "https://api.tryanotherone.com/v1";
  const fakeBearer = `Bearer ${fakeApiKey}`;
  let modelListRequests = 0;

  await page.route("**/api/me/llm-models", async (route) => {
    expect(route.request().method()).toBe("GET");
    modelListRequests += 1;

    if (modelListRequests === 1) {
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          provider: "compatible",
          credentialSource: "user-vault",
          models: [
            { id: "tryanotherone/e2e-affection-mini", ownedBy: "tryanotherone" },
            { id: "tryanotherone/e2e-memory-pro", ownedBy: "tryanotherone" }
          ]
        })
      });
      return;
    }

    if (modelListRequests === 2) {
      await route.fulfill({
        contentType: "application/json",
        status: 400,
        body: JSON.stringify({
          error: "读取模型列表超时，请稍后再试。",
          errorType: "provider_timeout",
          retryable: true
        })
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      status: 400,
      body: JSON.stringify({
        error: "模型供应商返回格式不兼容。",
        errorType: "invalid_provider_response",
        retryable: false,
        diagnostic: `${fakeBearer} via ${fakeBaseUrl} prompt rawPayload stack at Object.test (C:\\secret\\provider.ts:1:1)`
      })
    });
  });

  await loginAsFreshUser(page, "settings-models");

  await page.getByLabel("Base URL").fill(fakeBaseUrl);
  await page.getByLabel("API Key").fill(fakeApiKey);
  await page.getByRole("button", { name: "读取模型列表" }).click();

  await expect(page.getByText("已保存连接配置")).toBeVisible();
  await expect(page.getByText(/已读取 2 个模型 · compatible · 用户 vault/)).toBeVisible();
  await expect(page.getByRole("button", { name: /tryanotherone\/e2e-memory-pro/ })).toBeVisible();
  await expect(page.getByLabel("API Key")).toHaveValue("");
  await expect(page.getByText(fakeApiKey)).toHaveCount(0);

  await page.getByRole("button", { name: /tryanotherone\/e2e-memory-pro/ }).click();
  await expect(page.getByLabel("模型")).toHaveValue("tryanotherone/e2e-memory-pro");

  await page.getByRole("button", { name: "读取模型列表" }).click();
  await expect(page.getByText("读取模型列表超时，请稍后再试。（请求超时，可以稍后重试）")).toBeVisible();
  await expect(page.getByText("这通常是网络波动、网关临时不可达或地址写错。确认供应商地址后可以重试；也可以先手动填写模型名测试聊天链路。")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试读取" })).toBeVisible();
  await expect(page.getByRole("button", { name: "改为手动填写" })).toBeVisible();
  await expect(page.getByText(fakeApiKey)).toHaveCount(0);

  await page.getByRole("button", { name: "重试读取" }).click();
  await expect(page.getByText("Bearer [已隐藏]")).toBeVisible();
  await expect(page.getByText("[已隐藏 Base URL]")).toBeVisible();
  await expect(page.getByText("[已隐藏调试字段]")).toBeVisible();
  await expect(page.getByText("[已隐藏堆栈]")).toBeVisible();
  await expect(page.getByText(fakeApiKey)).toHaveCount(0);
  await expect(page.getByText(fakeBaseUrl)).toHaveCount(0);
  await expect(page.getByText(fakeBearer)).toHaveCount(0);
  expect(modelListRequests).toBe(3);
});

test("settings export downloads a redacted JSON snapshot", async ({ page }) => {
  const fakeApiKey = `e2e-export-key-${Date.now()}-1234`;
  const fakeBaseUrl = "https://provider.example.com/v1";

  await loginAsFreshUser(page, "settings-export");

  if (await page.getByRole("button", { name: "删除密钥" }).isVisible()) {
    await page.getByRole("button", { name: "删除密钥" }).click();
    await expect(page.getByText("未保存用户密钥，将使用服务端环境变量或 mock。")).toBeVisible();
  }
  await page.getByLabel("Base URL").fill(fakeBaseUrl);
  await page.getByLabel("模型").fill("e2e-export-model");
  await page.getByLabel("API Key").fill(fakeApiKey);
  await expect(page.getByLabel("API Key")).toHaveValue(fakeApiKey);
  await expect(page.getByRole("button", { name: "保存连接配置" })).toBeEnabled();
  await page.getByRole("button", { name: "保存连接配置" }).click();
  await expect(page.getByText("已保存连接配置")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^perpetual-renewal-export-\d{4}-\d{2}-\d{2}\.json$/);

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const rawSnapshot = await readFile(downloadPath!, "utf8");
  const snapshot = JSON.parse(rawSnapshot);

  expect(snapshot.privacy).toMatchObject({
    ownDataOnly: true,
    providerSecretsExcluded: true,
    vaultCiphertextExcluded: true,
    providerEndpointExcluded: true
  });
  expect(snapshot.credentialSummary.llm).toMatchObject({
    configured: true,
    provider: "compatible",
    model: "e2e-export-model",
    credentialSource: "user-vault"
  });
  expect(rawSnapshot).not.toContain(fakeApiKey);
  expect(rawSnapshot).not.toContain(fakeBaseUrl);
  for (const key of collectObjectKeys(snapshot)) {
    expect(key).not.toMatch(
      /^(apiKey|baseUrl|encryptedApiKey|keyIv|keyAuthTag|keyFingerprint|keyPreview|vaultCiphertext)$/i
    );
  }

  await expect(page.getByText(/已下载 perpetual-renewal-export-\d{4}-\d{2}-\d{2}\.json/)).toBeVisible();

  await page.getByRole("button", { name: "删除密钥" }).click();
  await expect(page.getByText("未保存用户密钥，将使用服务端环境变量或 mock。")).toBeVisible();
});

test("account deletion requires explicit confirmation before redirecting to login", async ({ page }) => {
  let deleteRequestWasConfirmed = false;
  await page.route("**/api/me/account", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().postDataJSON()).toMatchObject({ confirmation: "删除我的账号" });
    deleteRequestWasConfirmed = true;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        deleted: true,
        persistence: "memory",
        counts: {},
        sessionCleared: true,
        confirmationRequired: "删除我的账号"
      })
    });
  });

  await loginAsFreshUser(page, "settings-delete");

  const deleteButton = page.getByRole("button", { name: "删除账号" });
  await expect(deleteButton).toBeDisabled();

  await page.getByLabel("删除确认").fill("删除账号");
  await expect(deleteButton).toBeDisabled();

  await page.getByLabel("删除确认").fill("删除我的账号");
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "进入生生不息" })).toBeVisible();
  expect(deleteRequestWasConfirmed).toBe(true);
});

test("settings remains usable at 320px and 768px widths", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 768, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await loginAsFreshUser(page, `settings-responsive-${viewport.width}`);

    await expect(page.getByRole("heading", { name: "基础资料" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "模型供应商" })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出数据" })).toBeVisible();
    await expect(page.getByRole("button", { name: "重新检查" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page
      .getByLabel("昵称")
      .fill(`响应式${viewport.width}-${Date.now().toString(36)}`);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("button", { exact: true, name: "保存" })).toBeEnabled();
    await page.getByRole("button", { exact: true, name: "保存" }).click();
    await expect(page.getByText("已保存").last()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

function collectObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectObjectKeys);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, item]) => [key, ...collectObjectKeys(item)]);
}
