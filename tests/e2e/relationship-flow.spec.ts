import { expect, test, type Page } from "@playwright/test";

test("login, create relationship, chat, confirm memory, draft proactive message, logout", async ({
  page
}) => {
  const unique = Date.now();
  const companionName = `回响${unique}`;
  const firstMessage = "我记得我们第一次聊天时，我说过我害怕被突然丢下。";

  const chatFixture = await stubChatResponseWithPendingMemory(page, unique, firstMessage);
  await stubProactiveDrafts(page, unique);

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`e2e-${unique}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("E2E 用户");
  await page.getByRole("button", { name: "进入" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "生生不息" })).toBeVisible();
  await expect(page.getByRole("button", { name: "创建关系对象" }).first()).toBeVisible();

  await page.getByRole("button", { name: "创建关系对象" }).first().click();
  await expect(page.getByRole("heading", { name: "创建关系对象" })).toBeVisible();
  await page.getByLabel("名字").fill(companionName);
  await page.getByLabel("具体关系").fill("端到端测试关系");
  await page.getByLabel("性格关键词").fill("温柔、稳定、可验证");
  await page.getByLabel("语气").fill("温柔，稳定，能承接想念");
  const createCompanionResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/companions") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "创建并开始聊天" }).last().click();
  const createCompanionPayload = (await createCompanionResponse).json() as Promise<{
    companion?: { id?: string };
  }>;
  chatFixture.setCompanionId((await createCompanionPayload).companion?.id);

  await expect(page.getByRole("heading", { exact: true, name: companionName })).toBeVisible();
  await expect(page.getByRole("button", { name: "语音输入" })).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("删除");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "删除关系" }).click();
  await page.getByPlaceholder("把想说的话放在这里").fill(firstMessage);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(firstMessage)).toBeVisible();
  await expect(page.getByText("我在这里，先把这句话稳稳接住。")).toBeVisible();
  await expect(page.locator(".status-line")).toHaveText(/已回复|用户消息已保存/, {
    timeout: 15_000
  });

  await page.getByRole("button", { name: "记忆" }).click();
  await expect(page.getByRole("heading", { name: "记忆管理" })).toBeVisible();
  await expect(page.getByText("候选与长期记忆")).toBeVisible();
  await page.getByRole("button", { name: "确认" }).first().click();
  await expect(page.getByText("记忆状态已更新")).toBeVisible();
  await expect(page.getByText(/active/)).toBeVisible();

  await page.getByRole("button", { name: "导入素材" }).click();
  await expect(page.getByRole("heading", { name: "导入素材" })).toBeVisible();
  await page.getByRole("button", { name: "多段" }).click();
  await page
    .getByLabel("每行一条")
    .fill("她喜欢把晚安说得很轻\n她喜欢把晚安说得很轻\n她会记得雨天要提醒我带伞");
  await page.getByRole("button", { name: "导入为候选" }).click();
  await expect(page.getByText(/已导入 \d+ 条候选记忆/)).toBeVisible();
  await expect(page.getByText(/本次重复 1 条/)).toBeVisible();
  await page.getByLabel("每行一条").fill("她喜欢把晚安说得很轻");
  await page.getByRole("button", { name: "导入为候选" }).click();
  await expect(page.getByText("这些内容已存在，没有新增候选。")).toBeVisible();
  await expect(page.getByText(/已存在 1 条/)).toBeVisible();
  await page.getByRole("button", { name: "JSONL" }).click();
  await page.getByLabel("JSON Lines").fill("");
  await expect(page.getByLabel("JSON Lines")).toHaveValue("");
  await page.getByLabel("选择文本文件").setInputFiles({
    name: "broken-import.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not valid json")
  });
  await expect(page.getByText("JSON 文件无法解析，请检查格式后再导入。")).toBeVisible();
  await expect(page.getByText("已读取：broken-import.json")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导入为候选" })).toBeDisabled();
  await page.getByLabel("选择文本文件").setInputFiles({
    name: "e2e-memories.jsonl",
    mimeType: "application/x-ndjson",
    buffer: Buffer.from(
      [
        JSON.stringify({
          text: "她会把文件里的想念也当成一条可以确认的记忆。"
        }),
        JSON.stringify({
          sourceKind: "tone_sample",
          content: "文件导入的语气样例要温柔一点。"
        })
      ].join("\n")
    )
  });
  await expect(page.getByText("已读取：e2e-memories.jsonl")).toBeVisible();
  await expect(page.getByLabel("JSON Lines")).toHaveValue(/文件导入的语气样例/);
  await page.getByRole("button", { name: "导入为候选" }).click();
  await expect(page.getByText(/已导入 \d+ 条候选记忆/)).toBeVisible();

  await page.getByRole("button", { name: "主动回响" }).click();
  await expect(page.getByRole("heading", { name: "主动回响" })).toBeVisible();
  await expect(page.getByText("站内草稿")).toBeVisible();
  await expect(page.getByText(/当前节奏 每 1 分钟/)).toBeVisible();
  await expect(page.getByText(/自动检查每 1 分钟/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^草稿 \d+$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^已发送 \d+$/ })).toBeVisible();
  await expect(page.getByText(/撒娇式/).first()).toBeVisible();
  await page.getByRole("button", { name: "标记已发送" }).first().click();
  await expect(page.getByText("主动回响已标记为已发送")).toBeVisible();
  await page.getByRole("button", { name: /^已发送 \d+$/ }).click();
  await expect(page.getByRole("button", { name: "恢复草稿" }).first()).toBeVisible();
  await page.getByRole("button", { name: "恢复草稿" }).first().click();
  await expect(page.getByText("主动回响已标记为草稿")).toBeVisible();
  await page.getByRole("button", { name: /^草稿 \d+$/ }).click();
  await expect(page.getByRole("button", { name: "标记已发送" }).first()).toBeVisible();

  await page.getByRole("link", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "账号与资料" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出数据" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "配置状态" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新检查" })).toBeVisible();
  await expect(page.getByText(/PostgreSQL 数据库/)).toBeVisible();
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL("/login");
});

test("proactive panel surfaces one-minute check status for local trials", async ({ page }) => {
  const unique = Date.now();
  const companionName = `一分钟回响${unique}`;

  await stubProactiveDrafts(page, unique);

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`proactive-${unique}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("主动回响用户");
  await page.getByRole("button", { name: "进入" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "生生不息" })).toBeVisible();
  await page.getByRole("button", { name: "创建关系对象" }).first().click();
  await expect(page.getByRole("heading", { name: "创建关系对象" })).toBeVisible();
  await page.getByLabel("名字").fill(companionName);
  await page.getByLabel("具体关系").fill("主动回响体验关系");
  await page.getByLabel("性格关键词").fill("亲近、稳定、会主动回应");
  await page.getByLabel("语气").fill("撒娇式，但不埋怨");
  await page.getByRole("button", { name: "创建并开始聊天" }).last().click();

  await expect(page.getByRole("heading", { exact: true, name: companionName })).toBeVisible();
  await page.getByRole("button", { name: "主动回响" }).click();
  await expect(page.getByRole("heading", { name: "主动回响" })).toBeVisible();
  await expect(page.getByText("站内草稿")).toBeVisible();
  await expect(page.getByText(/当前节奏 每 1 分钟/)).toBeVisible();
  await expect(page.getByText(/自动检查每 1 分钟/)).toBeVisible();
  await expect(page.getByText(/手动生成 \d+ 条草稿|手动检查完成/)).toBeVisible();
});

test("mobile workspace keeps panels usable without horizontal overflow", async ({ page }) => {
  const unique = Date.now();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`mobile-${unique}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("移动端用户");
  await page.getByRole("button", { name: "进入" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "生生不息" })).toBeVisible();
  await expect(page.getByRole("button", { name: "创建关系对象" }).first()).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
  expect(hasHorizontalOverflow).toBe(false);

  await expect(page.getByRole("button", { name: "创建关系对象" }).first()).toBeVisible();
  await page.getByRole("button", { name: "创建关系对象" }).first().click();
  await expect(page.getByRole("heading", { name: "创建关系对象" })).toBeVisible();
  await expect(page.getByLabel("名字")).toBeVisible();

  const createFormOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
  expect(createFormOverflow).toBe(false);

  await page.getByRole("link", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "账号与资料" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出数据" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "配置状态" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新检查" })).toBeVisible();

  const settingsOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
  expect(settingsOverflow).toBe(false);
});

test("relationship create failure shows server copy and keeps the draft editable", async ({
  page
}) => {
  const unique = Date.now();
  const draftName = `失败回响${unique}`;
  const serverMessage = "名字不能为空，请给这段关系一个称呼。";

  await page.route("**/api/companions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      status: 400,
      body: JSON.stringify({ error: serverMessage })
    });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`create-failure-${unique}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("关系表单 QA");
  await page.getByRole("button", { name: "进入" }).click();

  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "创建关系对象" }).first().click();
  await expect(page.getByRole("heading", { name: "创建关系对象" })).toBeVisible();

  await page.getByLabel("名字").fill(draftName);
  await page.getByLabel("具体关系").fill("失败后也要留住的关系");
  await page.getByRole("button", { name: "创建并开始聊天" }).last().click();

  await expect(page.getByText(serverMessage)).toBeVisible();
  await expect(page.locator(".status-line")).toHaveText("新建关系失败，请检查后重试");
  await expect(page.getByLabel("名字")).toHaveValue(draftName);
  await expect(page.getByLabel("具体关系")).toHaveValue("失败后也要留住的关系");
  await expect(page.getByRole("button", { name: "创建并开始聊天" })).toBeEnabled();
});

test("workspace usage errors redact provider secrets before display", async ({ page }) => {
  const unique = Date.now();
  const fakeApiKey = `sk-workspace-usage-${unique}-redaction-key`;
  const fakeBaseUrl = "https://workspace-usage.failure.example.com/v1";
  const leakedMessage = [
    "调用看板读取失败",
    `Authorization: Bearer ${fakeApiKey}`,
    `endpoint ${fakeBaseUrl}`,
    "prompt rawPayload stack",
    "at provider.fetch (src/lib/provider.ts:12:3)"
  ].join(" ");

  await page.route("**/api/usage/model-calls?rangeDays=7", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 500,
      body: JSON.stringify({ error: leakedMessage })
    });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`usage-redaction-${unique}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("调用看板 QA");
  await page.getByRole("button", { name: "进入" }).click();

  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "模型调用看板" }).click();

  await expect(page.getByText("调用看板读取失败")).toBeVisible();
  await expect(page.getByText("Bearer [已隐藏]")).toBeVisible();
  await expect(page.getByText("[已隐藏 Base URL]")).toBeVisible();
  await expect(page.getByText("[已隐藏调试字段]").first()).toBeVisible();
  await expect(page.getByText("[已隐藏堆栈]")).toBeVisible();
  await expect(page.getByText(fakeApiKey)).toHaveCount(0);
  await expect(page.getByText(fakeBaseUrl)).toHaveCount(0);
  await expect(page.getByText("rawPayload")).toHaveCount(0);
  await expect(page.getByText("src/lib/provider.ts")).toHaveCount(0);
});

test("voice synthesis fallback reason is redacted before display", async ({ page }) => {
  const unique = Date.now();
  const companionName = `语音回响${unique}`;
  const fakeApiKey = `sk-voice-preview-${unique}-redaction-key`;
  const fakeBaseUrl = "https://voice-preview.failure.example.com/v1";
  const leakedReason = [
    "语音供应商回退",
    `Authorization: Bearer ${fakeApiKey}`,
    `endpoint ${fakeBaseUrl}`,
    "prompt rawPayload stack",
    "at voice.fetch (src/lib/voice/provider.ts:22:5)"
  ].join(" ");
  let synthesizeRequests = 0;
  let voiceMessages: Array<{
    id: string;
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    metadata: { provider?: string; model?: string } | null;
    createdAt: string;
  }> = [];

  await page.route("**/api/conversations/*/messages", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({ messages: voiceMessages })
      });
      return;
    }
    if (method !== "POST") {
      await route.fallback();
      return;
    }

    const now = new Date().toISOString();
    const conversationId = getConversationIdFromRequest(route.request().url());
    voiceMessages = [
      {
        id: `user-message-${unique}`,
        conversationId,
        role: "user",
        content: "今天想听一段声音。",
        metadata: null,
        createdAt: now
      },
      {
        id: `assistant-message-${unique}`,
        conversationId,
        role: "assistant",
        content: "我在这里，慢慢听你说。",
        metadata: {
          provider: "mock",
          model: "mock-local"
        },
        createdAt: now
      }
    ];

    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        userMessage: voiceMessages[0],
        assistantMessage: voiceMessages[1],
        pendingMemory: null,
        relationshipState: {
          id: `relationship-state-${unique}`,
          companionId: `voice-redaction-companion-${unique}`,
          familiarityScore: 12,
          closenessScore: 10,
          recentEmotion: "想念",
          importantEvents: [],
          lastInteractionAt: now,
          explanation: "语音脱敏 E2E",
          createdAt: now,
          updatedAt: now
        },
        completion: {
          provider: "mock",
          model: "mock-local"
        }
      })
    });
  });

  await page.route("**/api/voice/synthesize", async (route) => {
    expect(route.request().method()).toBe("POST");
    synthesizeRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        audioDataUrl: "data:audio/wav;base64,UklGRg==",
        provider: "mock",
        requestedProvider: "shared-llm",
        credentialSource: "user-vault",
        model: "mock-voice",
        voice: "warm",
        fallback: true,
        fallbackKind: "provider_error",
        fallbackReason: leakedReason
      })
    });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`voice-redaction-${unique}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("语音脱敏 QA");
  await page.getByRole("button", { name: "进入" }).click();

  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "创建关系对象" }).first().click();
  await page.getByLabel("名字").fill(companionName);
  await page.getByRole("button", { name: "创建并开始聊天" }).last().click();
  await expect(page.getByRole("heading", { exact: true, name: companionName })).toBeVisible();

  await page.getByPlaceholder("把想说的话放在这里").fill("今天想听一段声音。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("我在这里，慢慢听你说。")).toBeVisible();
  await expect(page.getByRole("button", { name: "朗读最近回复" })).toBeEnabled();

  await page.getByRole("button", { name: "朗读最近回复" }).click();
  await expect(page.getByText("语音回复已生成")).toBeVisible();
  await expect(page.getByText("语音供应商回退")).toBeVisible();
  await expect(page.getByText("Bearer [已隐藏]")).toBeVisible();
  await expect(page.getByText("[已隐藏 Base URL]")).toBeVisible();
  await expect(page.getByText("[已隐藏调试字段]").first()).toBeVisible();
  await expect(page.getByText("[已隐藏堆栈]")).toBeVisible();
  await expect(page.getByText(fakeApiKey)).toHaveCount(0);
  await expect(page.getByText(fakeBaseUrl)).toHaveCount(0);
  await expect(page.getByText("rawPayload")).toHaveCount(0);
  await expect(page.getByText("src/lib/voice/provider.ts")).toHaveCount(0);
  expect(synthesizeRequests).toBe(1);
});

async function stubChatResponseWithPendingMemory(page: Page, unique: number, expectedContent: string) {
  const now = new Date().toISOString();
  let companionId = `e2e-companion-${unique}`;
  let fixtureMessages: Array<{
    id: string;
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    metadata: { provider?: string; model?: string } | null;
    createdAt: string;
  }> = [];
  const pendingMemory = {
    id: `e2e-memory-${unique}`,
    userId: `e2e-user-${unique}`,
    companionId,
    sourceMessageId: `e2e-user-message-${unique}`,
    type: "relationship_event",
    status: "pending",
    content: "用户害怕被突然丢下，需要稳定承接。",
    confidence: 0.92,
    createdAt: now,
    updatedAt: now
  };

  await page.route("**/api/conversations/*/messages", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({ messages: fixtureMessages })
      });
      return;
    }
    if (method !== "POST") {
      await route.fallback();
      return;
    }

    const body = route.request().postDataJSON() as { content?: string };
    expect(body.content).toBe(expectedContent);
    const conversationId = getConversationIdFromRequest(route.request().url());
    fixtureMessages = [
      {
        id: pendingMemory.sourceMessageId,
        conversationId,
        role: "user",
        content: expectedContent,
        metadata: null,
        createdAt: now
      },
      {
        id: `e2e-assistant-message-${unique}`,
        conversationId,
        role: "assistant",
        content: "我在这里，先把这句话稳稳接住。",
        metadata: {
          provider: "e2e",
          model: "stable-fixture"
        },
        createdAt: now
      }
    ];

    await route.fulfill({
      contentType: "application/json",
      status: 201,
      body: JSON.stringify({
        userMessage: fixtureMessages[0],
        assistantMessage: fixtureMessages[1],
        pendingMemory,
        relationshipState: {
          id: `e2e-relationship-state-${unique}`,
          companionId,
          familiarityScore: 14,
          closenessScore: 12,
          recentEmotion: "害怕被丢下",
          importantEvents: ["第一次聊天时提到害怕被突然丢下"],
          lastInteractionAt: now,
          explanation: "E2E 稳定夹具",
          createdAt: now,
          updatedAt: now
        },
        completion: {
          provider: "e2e",
          model: "stable-fixture"
        }
      })
    });
  });

  await page.route(`**/api/memories/${pendingMemory.id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }

    const body = route.request().postDataJSON() as { status?: string };
    expect(body.status).toBe("active");

    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        memory: {
          ...pendingMemory,
          companionId,
          status: "active",
          updatedAt: new Date().toISOString()
        }
      })
    });
  });

  return {
    setCompanionId(nextCompanionId: string | undefined) {
      companionId = nextCompanionId ?? companionId;
      pendingMemory.companionId = companionId;
    }
  };
}

function getConversationIdFromRequest(url: string) {
  const match = /\/api\/conversations\/([^/]+)\/messages/.exec(new URL(url).pathname);
  return match?.[1] ?? "e2e-conversation";
}

async function stubProactiveDrafts(page: Page, unique: number) {
  const draftId = `e2e-proactive-${unique}`;
  const draftContent = "我有一点点想你啦，但不是催你，只是想轻轻贴近一下。";

  await page.route("**/api/companions/*/proactive-drafts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    const now = new Date().toISOString();
    const nextCandidateAt = new Date(Date.now() + 60_000).toISOString();

    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        data: [
          {
            id: draftId,
            companionId: `e2e-companion-${unique}`,
            kind: "PLAYFUL_MISS_YOU",
            content: draftContent,
            reason: "E2E 稳定验证撒娇式主动回响。",
            scheduledAt: now,
            nextCandidateAt,
            frequency: {
              preset: "1m",
              everyMinutes: 1,
              label: "每 1 分钟"
            },
            safety: "allow",
            status: "draft",
            createdAt: now,
            updatedAt: now
          }
        ],
        safety: {
          action: "allow",
          reason: "E2E fixture"
        },
        persistence: "e2e",
        frequency: {
          preset: "1m",
          everyMinutes: 1,
          label: "每 1 分钟"
        },
        status: "draft",
        generatedCount: 1,
        savedCount: 1
      })
    });
  });

  await page.route(`**/api/proactive-messages/${draftId}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }

    const body = route.request().postDataJSON() as { status?: string };
    const status = body.status ?? "draft";
    const now = new Date().toISOString();

    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        proactiveMessage: {
          id: draftId,
          companionId: `e2e-companion-${unique}`,
          kind: "PLAYFUL_MISS_YOU",
          content: draftContent,
          reason: "E2E 稳定验证撒娇式主动回响。",
          safety: {
            result: "allow"
          },
          status,
          scheduledAt: now,
          createdAt: now,
          updatedAt: now
        },
        persistence: "e2e"
      })
    });
  });
}
