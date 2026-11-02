import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "./fixtures";

const transcript = "小林：今天下雨，记得带伞呀。\n我：上次一起去海边还挺开心的。\n小林：是呀，下次再一起看海。\n路人：THIRD_PERSON_PRIVATE_MARKER\n我：谢谢你一直记得。";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`chat-import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("记录导入测试");
  await page.getByRole("button", { name: "进入", exact: true }).click();
  await expect(page).toHaveURL("/");
}

async function parse(page: Page) {
  await page.getByLabel("或粘贴聊天记录").fill(transcript);
  await page.getByRole("button", { name: "本地解析记录" }).click();
  await page.getByLabel("要创建的人物", { exact: false }).selectOption("小林");
  await page.getByLabel("我在记录中的说话者").selectOption("我");
}

async function companions(page: Page) {
  return (await (await page.request.get("/api/companions")).json()).companions;
}

test("chat records create a reviewed character with memories, without saving source files or trial messages", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "从聊天记录创建", exact: true }).click();
  await expect(page).toHaveURL("/create-from-chat");
  await page.getByLabel("选择聊天记录文件").setInputFiles({ name: "record.txt", mimeType: "text/plain", buffer: Buffer.from(transcript) });
  await page.getByLabel("要创建的人物", { exact: false }).selectOption("小林");
  await page.getByLabel("我在记录中的说话者").selectOption("我");
  await page.getByRole("button", { name: "提炼人物 →" }).click();
  await expect(page.getByRole("heading", { name: "核对设定", exact: true })).toBeVisible();
  await expect(page.getByText(/以下是本地基础草稿/)).toBeVisible();
  expect(await companions(page)).toHaveLength(0);
  await page.getByLabel("人物名字", { exact: false }).fill("海边的小林");
  await page.getByLabel("说话方式", { exact: false }).fill("简短自然，会说‘记得带伞呀’，不用加粗符号。");
  await page.getByLabel("共同回忆", { exact: false }).fill("用户与对方曾一起去海边。");
  await page.screenshot({ path: "design/previews/2026-11-02/chat-character-review-implemented.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "design/previews/2026-11-02/chat-character-mobile-implemented.png", fullPage: true });
  await page.getByRole("button", { name: "去试聊 →" }).click();
  await expect(page.getByRole("button", { name: "确认设定 →" })).toBeDisabled();
  await page.getByLabel("试聊消息", { exact: false }).fill("还记得看海吗？");
  await page.getByRole("button", { name: "发送试聊", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("本地预览");
  expect(await companions(page)).toHaveLength(0);
  await page.getByRole("button", { name: "← 返回修改设定" }).click();
  await page.getByLabel("对你的称呼").fill("小雨");
  await page.getByRole("button", { name: "去试聊 →" }).click();
  await expect(page.getByRole("button", { name: "确认设定 →" })).toBeDisabled();
  await expect(page.getByRole("log")).not.toContainText("还记得看海吗");
  await page.getByLabel("试聊消息", { exact: false }).fill("下午好呀");
  await page.getByRole("button", { name: "发送试聊", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认设定 →" })).toBeEnabled();
  await page.getByRole("button", { name: "确认设定 →" }).click();
  await expect(page.getByRole("button", { name: "确认创建人物", exact: true })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认创建人物", exact: true }).click();
  await expect(page).toHaveURL("/");
  const saved = await companions(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ name: "海边的小林", userAddress: "小雨", proactiveMessagesEnabled: false });
  expect(saved[0].speakingStyle).toContain("记得带伞呀");
  expect(saved[0].memories).toEqual(expect.arrayContaining([expect.objectContaining({ content: "用户与对方曾一起去海边。", status: "active", type: "relationship_event" })]));
  expect((await (await page.request.get(`/api/conversations/${saved[0].conversationId}/messages`)).json()).messages).toHaveLength(0);
  await page.reload();
  expect((await companions(page))[0].name).toBe("海边的小林");
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain("THIRD_PERSON_PRIVATE_MARKER");
  expect(storage).not.toContain("还记得看海吗");
});

test("chat character analysis and trial use the user's provider, retry safely, and exclude other speakers", async ({ page }) => {
  const requests: Array<{ body: string; auth?: string }> = [];
  let previews = 0;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push({ body, auth: req.headers.authorization });
    const analyzing = body.includes("你负责从聊天记录整理");
    if (!analyzing && ++previews === 1) { res.writeHead(503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "private-provider-diagnostic" })); return; }
    const draft = { name: "小林", relationshipKind: "FRIEND", customKind: "", userAddress: "", personality: ["细心"], speakingStyle: "口语简短，关心对方", background: "用户与对方曾谈及一起看海。", toneExamples: ["今天下雨，记得带伞呀。", "上次一起去海边还挺开心的。"], sharedMemories: ["用户与对方曾一起去海边。"] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ model: "character-test-model", choices: [{ message: { content: analyzing ? JSON.stringify(draft) : "记得呀，等晴天再一起聊聊海。" } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await login(page);
    const key = "e2e-character-fixture-key-12345678";
    expect((await page.request.put("/api/me/llm-credential", { data: { provider: "compatible", apiKey: key, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: "character-test-model" } })).ok()).toBe(true);
    await page.goto("/create-from-chat");
    await parse(page);
    await page.getByRole("button", { name: "提炼人物 →" }).click();
    await expect(page.getByRole("heading", { name: "核对设定", exact: true })).toBeVisible();
    await expect(page.getByLabel("语气示例", { exact: false })).toHaveValue("今天下雨，记得带伞呀。");
    expect(requests[0].auth).toBe(`Bearer ${key}`);
    expect(requests[0].body).not.toContain("THIRD_PERSON_PRIVATE_MARKER");
    await page.getByLabel("说话方式", { exact: false }).fill("EDITED_STYLE_MARKER，保持自然温柔");
    await page.getByRole("button", { name: "去试聊 →" }).click();
    await page.getByLabel("试聊消息", { exact: false }).fill("还记得我们一起去海边的事吗？");
    await page.getByRole("button", { name: "发送试聊", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("请重试");
    await expect(page.getByLabel("试聊消息", { exact: false })).toHaveValue("还记得我们一起去海边的事吗？");
    await expect(page.locator("body")).not.toContainText("private-provider-diagnostic");
    await page.getByRole("button", { name: "发送试聊", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("记得呀，等晴天再一起聊聊海。");
    expect(requests.at(-1)?.body).toContain("EDITED_STYLE_MARKER");
    expect(requests.at(-1)?.body).toContain("用户与对方曾一起去海边");
    expect(await companions(page)).toHaveLength(0);
    const me = await (await page.request.get("/api/me")).json();
    await expect(page.locator("body")).not.toContainText(key);
    await page.getByRole("button", { name: "确认设定 →" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认创建人物", exact: true }).click();
    await expect(page).toHaveURL("/");
    expect((await companions(page))[0].userId).toBe(me.user.id);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test("chat character import validates speaker choices, clears stale results, and requires login", async ({ page }) => {
  await page.goto("/create-from-chat");
  await expect(page).toHaveURL("/login");
  await login(page);
  await page.goto("/create-from-chat");
  await parse(page);
  await expect(page.getByLabel("我在记录中的说话者").locator('option[value="小林"]')).toHaveAttribute("disabled", "");
  await page.getByLabel("我在记录中的说话者").selectOption("");
  await expect(page.getByRole("button", { name: "提炼人物 →" })).toBeDisabled();
  await page.getByLabel("我在记录中的说话者").selectOption("我");
  await page.getByRole("button", { name: "提炼人物 →" }).click();
  await expect(page.getByRole("heading", { name: "核对设定", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← 上一步" }).click();
  await page.getByLabel("或粘贴聊天记录").fill("没有明确说话者的一段文本。");
  await page.getByRole("button", { name: "本地解析记录" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("未识别到至少两位说话者");
  await page.getByLabel("选择聊天记录文件").setInputFiles({ name: "binary.db", mimeType: "application/octet-stream", buffer: Buffer.from("SQLite format 3") });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("TXT、JSON 或 JSONL");
  expect(await companions(page)).toHaveLength(0);
  await page.getByRole("button", { name: "← 返回聊天" }).click();
  await expect(page).toHaveURL("/");
});
