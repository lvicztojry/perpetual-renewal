import { expect, test } from "@playwright/test";

test("switching relationships isolates drafts, delayed history, and in-flight replies", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`switch-${Date.now()}@perpetual-renewal.local`);
  await page.getByRole("button", { name: "进入", exact: true }).click();
  await expect(page).toHaveURL("/");

  const create = async (name: string) => {
    const response = await page.request.post("/api/companions", {
      data: { name, relationshipKind: "CUSTOM", speakingStyle: "温柔", proactiveMessagesEnabled: false }
    });
    expect(response.status()).toBe(201);
    return (await response.json()).companion;
  };
  const first = await create("切换测试甲");
  const second = await create("切换测试乙");
  const firstMessages: Array<Record<string, unknown>> = [];
  let releaseReply!: () => void;
  let replyStarted!: () => void;
  const replyGate = new Promise<void>((resolve) => { releaseReply = resolve; });
  const started = new Promise<void>((resolve) => { replyStarted = resolve; });
  let releaseHistory!: () => void;
  let holdSecondHistory = false;
  const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
  await page.route("**/api/conversations/*/messages", async (route) => {
    const isFirst = route.request().url().includes(first.conversationId);
    if (route.request().method() === "POST") {
      replyStarted();
      await replyGate;
      const now = new Date().toISOString();
      firstMessages.push(
        { id: "switch-user", conversationId: first.conversationId, role: "user", content: "只发给甲", createdAt: now },
        { id: "switch-reply", conversationId: first.conversationId, role: "assistant", content: "甲的迟到回复", createdAt: now }
      );
      await route.fulfill({ json: {
        userMessage: firstMessages[0], assistantMessage: firstMessages[1],
        pendingMemory: null, relationshipState: first.relationshipState,
        completion: { provider: "mock", model: "mock-local" }
      } });
      return;
    }
    if (!isFirst && holdSecondHistory) await historyGate;
    await route.fulfill({ json: { messages: isFirst ? firstMessages : [] } });
  });

  await page.reload();
  await page.getByTitle(`切换到 ${second.name}`).click();
  const composer = page.getByPlaceholder("把想说的话放在这里");
  await composer.fill("乙的未发送草稿");
  await page.getByTitle(`切换到 ${first.name}`).click();
  await expect(composer).toHaveValue("");
  await composer.fill("只发给甲");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await started;
  holdSecondHistory = true;
  await page.getByTitle(`切换到 ${second.name}`).click();
  await expect(composer).toHaveValue("乙的未发送草稿");
  releaseReply();
  await expect(composer).toBeEnabled();
  await expect(page.getByText("甲的迟到回复", { exact: true })).toHaveCount(0);
  await expect(composer).toHaveValue("乙的未发送草稿");
  releaseHistory();
  await page.getByTitle(`切换到 ${first.name}`).click();
  await expect(page.getByText("甲的迟到回复", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("");
  await page.getByTitle(`切换到 ${second.name}`).click();
  await expect(page.getByText("甲的迟到回复", { exact: true })).toHaveCount(0);
  await expect(composer).toHaveValue("乙的未发送草稿");
});
