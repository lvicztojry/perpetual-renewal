import { expect, test, type Page } from "./fixtures";
import type { CompanionProfile, MessageRecord } from "../../src/lib/renewal/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
type SendBody = { content: string; clientMessageId: string };
type Outcome = { status?: number; json: unknown } | { abort: true };
const composer = (page: Page) => page.getByPlaceholder("把想说的话放在这里");
const typing = (page: Page) => page.locator(".companion-heading").getByRole("status");
const bubble = (page: Page, content: string) => page.getByLabel("聊天记录").locator("article.message")
  .filter({ has: page.locator(".message-bubble").getByText(content, { exact: true }) });
async function expectPending(page: Page, content: string) {
  await expect(bubble(page, content)).toHaveCount(1);
  await expect(bubble(page, content)).toContainText("发送中");
  await expect(bubble(page, content).getByRole("button")).toHaveCount(0);
  await expect(typing(page)).toHaveText("对方正在输入…");
  await expect(page.getByRole("button", { name: "等待回复", exact: true })).toBeDisabled();
  await expect(composer(page)).toBeEnabled();
}
function reply(companion: CompanionProfile, body: SendBody) {
  const base = { conversationId: companion.conversationId, createdAt: new Date().toISOString() };
  const userMessage: MessageRecord = {
    ...base, id: `server-user-${body.clientMessageId}`, role: "user", content: body.content,
    metadata: { clientMessageId: body.clientMessageId }
  };
  const assistantMessage: MessageRecord = {
    ...base, id: `server-assistant-${body.clientMessageId}`, role: "assistant",
    content: `${companion.name}的回复`, metadata: { status: "sent" }
  };
  return { userMessage, assistantMessage, pendingMemory: null, relationshipState: companion.relationshipState,
    completion: { provider: "mock", model: "mock-local" } };
}
function historyGate(messages: MessageRecord[]) {
  return { started: deferred<void>(), release: deferred<void>(), messages: [...messages] };
}
async function setup(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`optimistic-${crypto.randomUUID()}@perpetual-renewal.local`);
  await page.getByRole("button", { name: "进入", exact: true }).click();
  await expect(page).toHaveURL("/");
  const create = async (name: string): Promise<CompanionProfile> => {
    const response = await page.request.post("/api/companions", {
      data: { name, relationshipKind: "CUSTOM", speakingStyle: "温柔", proactiveMessagesEnabled: false }
    });
    expect(response.status()).toBe(201);
    return (await response.json()).companion;
  };
  const first = await create("切换测试甲");
  const second = await create("切换测试乙");
  const history = new Map<string, MessageRecord[]>();
  const posts = new Map<string, { started: ReturnType<typeof deferred<SendBody>>; outcome: ReturnType<typeof deferred<Outcome>> }>();
  const delayedHistory = new Map<string, ReturnType<typeof historyGate>>();
  const mutations: Array<{ conversationId: string; body: Record<string, unknown> }> = [];
  function holdHistory(companion: CompanionProfile, messages: MessageRecord[]) {
    // Freeze the snapshot before any later POST can update server history.
    const held = historyGate(messages);
    delayedHistory.set(companion.conversationId, held);
    return held;
  }
  await page.route("**/api/conversations/*/messages", async (route) => {
    const request = route.request();
    const conversationId = new URL(request.url()).pathname.split("/").at(-2)!;
    if (request.method() === "GET") {
      const held = delayedHistory.get(conversationId);
      if (held) {
        delayedHistory.delete(conversationId);
        held.started.resolve();
        await held.release.promise;
      }
      await route.fulfill({ json: { messages: held ? held.messages : history.get(conversationId) ?? [] } });
      return;
    }
    if (request.method() === "POST") {
      const pending = posts.get(conversationId);
      if (!pending) {
        await route.fulfill({ status: 500, json: { error: "Unexpected extra send" } });
        throw new Error(`Unexpected POST for ${conversationId}`);
      }
      posts.delete(conversationId);
      pending.started.resolve(request.postDataJSON() as SendBody);
      const outcome = await pending.outcome.promise;
      if ("abort" in outcome) await route.abort("failed");
      else await route.fulfill({ status: outcome.status ?? 200, json: outcome.json });
      return;
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON();
      mutations.push({ conversationId, body });
      const message = history.get(conversationId)?.find((item) => item.id === body.messageId);
      if (!message) await route.fulfill({ status: 404, json: { error: "Unknown server message ID" } });
      else if (body.action === "regenerate") {
        Object.assign(message, { content: "重试后的回复", metadata: { status: "sent" } });
        await route.fulfill({ json: { assistantMessage: message, completion: { provider: "mock", model: "mock-local" } } });
      } else {
        message.metadata = { ...message.metadata, important: body.important };
        await route.fulfill({ json: { message } });
      }
      return;
    }
    await route.fallback();
  });
  async function select(companion: CompanionProfile) {
    await page.getByTitle(`切换到 ${companion.name}`).click();
    await expect(page.locator(".companion-heading").getByRole("heading")).toHaveText(companion.name);
  }
  async function send(companion: CompanionProfile, content: string) {
    const pending = { started: deferred<SendBody>(), outcome: deferred<Outcome>() };
    posts.set(companion.conversationId, pending);
    await composer(page).fill(content);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const body = await pending.started.promise;
    expect(body.content).toBe(content);
    expect(body.clientMessageId).toEqual(expect.any(String));
    expect(body.clientMessageId.length).toBeGreaterThan(0);
    await expect(composer(page)).toHaveValue("");
    await expectPending(page, content);
    return { ...pending, body };
  }
  async function succeed(companion: CompanionProfile, pending: Awaited<ReturnType<typeof send>>) {
    const payload = reply(companion, pending.body);
    history.set(companion.conversationId, [payload.userMessage, payload.assistantMessage]);
    const received = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/conversations/${companion.conversationId}/messages`);
    pending.outcome.resolve({ json: payload });
    await (await received).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    return payload;
  }
  await page.reload();
  await select(second);
  await select(first);
  return { first, second, history, mutations, select, send, succeed, holdHistory };
}
async function releaseHistory(page: Page, conversationId: string, held: ReturnType<typeof historyGate>) {
  const received = page.waitForResponse((response) => response.request().method() === "GET" &&
    new URL(response.url()).pathname === `/api/conversations/${conversationId}/messages`);
  held.release.resolve();
  await (await received).finished();
  // Let the released fetch and React render finish before negative assertions.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("optimistic send clears immediately, replaces the local ID, and preserves the next draft", async ({ page }) => {
  const h = await setup(page);
  const pending = await h.send(h.first, "立刻显示的用户消息");
  await composer(page).fill("下一条还没发送的草稿");
  const payload = await h.succeed(h.first, pending);
  await expect(bubble(page, payload.assistantMessage.content)).toBeVisible();
  await expect(bubble(page, pending.body.content)).toHaveCount(1);
  await expect(page.getByLabel("聊天记录").locator("article.message")).toHaveCount(2);
  await expect(bubble(page, pending.body.content)).not.toContainText("发送中");
  await expect(typing(page)).toHaveCount(0);
  await expect(composer(page)).toHaveValue("下一条还没发送的草稿");
  await bubble(page, pending.body.content).getByRole("button", { name: "标记为重要消息", exact: true }).click();
  await expect(bubble(page, pending.body.content).getByRole("button", { name: "取消重要标记", exact: true })).toBeVisible();
  expect(h.mutations).toEqual([{ conversationId: h.first.conversationId, body: {
    action: "set_important", messageId: payload.userMessage.id, important: true
  } }]);
});
for (const failure of ["HTTP", "network"] as const) {
  test(`${failure} failure retains an unconfirmed bubble and allows explicit editing without resending`, async ({ page }) => {
    const h = await setup(page);
    const pending = await h.send(h.first, "需要核对是否送达的消息");
    await composer(page).fill("不能被覆盖的新草稿");
    pending.outcome.resolve(failure === "HTTP"
      ? { status: 503, json: { error: "消息服务暂不可用" } } : { abort: true });
    const local = bubble(page, pending.body.content);
    await expect(local).toContainText("发送未确认，请刷新核对");
    await expect(local).not.toContainText("发送中");
    await expect(typing(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await expect(composer(page)).toHaveValue("不能被覆盖的新草稿");
    await expect(page.locator(".composer").getByRole("alert")).toBeVisible();
    if (failure === "HTTP") await expect(page.locator(".composer").getByRole("alert")).toContainText("消息服务暂不可用");
    await expect(local.getByRole("button", { name: "重新编辑", exact: true })).toBeDisabled();
    await expect(local.getByRole("button", { name: "标记为重要消息", exact: true })).toHaveCount(0);
    await expect(local.getByRole("button", { name: "删除这条消息", exact: true })).toHaveCount(0);
    await composer(page).fill("");
    await local.getByRole("button", { name: "重新编辑", exact: true }).click();
    await expect(local).toHaveCount(0);
    await expect(composer(page)).toHaveValue(pending.body.content);
    await expect(typing(page)).toHaveCount(0);
    expect(h.mutations).toEqual([]);
  });
}
test("assistantError keeps the persisted user and retries the server failed assistant placeholder", async ({ page }) => {
  const h = await setup(page);
  const pending = await h.send(h.first, "用户消息已经保存");
  const payload = reply(h.first, pending.body);
  payload.assistantMessage.content = "回复生成失败了。刚才的话我已经收到了，可以点重试让我重新回应。";
  payload.assistantMessage.metadata = { status: "failed" };
  h.history.set(h.first.conversationId, [payload.userMessage, payload.assistantMessage]);
  pending.outcome.resolve({ json: {
    ...payload, completion: null, assistantError: { message: "回复服务暂不可用", provider: "mock", status: 503 }
  } });
  await expect(bubble(page, payload.assistantMessage.content)).toContainText("回复失败，请重试");
  await expect(bubble(page, pending.body.content)).toHaveCount(1);
  await expect(bubble(page, pending.body.content)).not.toContainText("发送未确认");
  await expect(bubble(page, pending.body.content).getByRole("button", { name: "标记为重要消息", exact: true })).toBeEnabled();
  await expect(typing(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新编辑", exact: true })).toHaveCount(0);
  await bubble(page, payload.assistantMessage.content).getByRole("button", { name: "重试这条回复", exact: true }).click();
  await expect(bubble(page, "重试后的回复")).toBeVisible();
  await expect(page.getByLabel("聊天记录").locator("article.message")).toHaveCount(2);
  expect(h.mutations).toEqual([{ conversationId: h.first.conversationId, body: {
    action: "regenerate", messageId: payload.assistantMessage.id
  } }]);
});
test("switching relationships isolates drafts, delayed history, and independent in-flight replies", async ({ page }) => {
  const h = await setup(page);
  await h.select(h.second);
  await composer(page).fill("乙的未发送草稿");
  await h.select(h.first);
  await expect(composer(page)).toHaveValue("");
  const a = await h.send(h.first, "只发给甲");
  const delayedB = h.holdHistory(h.second, []);
  await h.select(h.second);
  await delayedB.started.promise;
  await expect(typing(page)).toHaveCount(0);
  await expect(bubble(page, a.body.content)).toHaveCount(0);
  await expect(composer(page)).toHaveValue("乙的未发送草稿");
  const b = await h.send(h.second, "只发给乙");
  expect(a.body.clientMessageId).not.toBe(b.body.clientMessageId);
  await releaseHistory(page, h.second.conversationId, delayedB);
  await expectPending(page, b.body.content);
  await h.select(h.first);
  await expectPending(page, a.body.content);
  await expect(bubble(page, b.body.content)).toHaveCount(0);
  await expect(composer(page)).toHaveValue("");
  const replyB = await h.succeed(h.second, b);
  await expectPending(page, a.body.content);
  await expect(bubble(page, replyB.assistantMessage.content)).toHaveCount(0);
  await h.select(h.second);
  await expect(bubble(page, replyB.assistantMessage.content)).toBeVisible();
  await expect(bubble(page, b.body.content)).toHaveCount(1);
  await expect(typing(page)).toHaveCount(0);
  await composer(page).fill("乙的下一条草稿");
  const replyA = await h.succeed(h.first, a);
  await h.select(h.first);
  await expect(bubble(page, replyA.assistantMessage.content)).toBeVisible();
  await expect(bubble(page, a.body.content)).toHaveCount(1);
  await expect(typing(page)).toHaveCount(0);
  await h.select(h.second);
  await expect(composer(page)).toHaveValue("乙的下一条草稿");
  await expect(bubble(page, replyA.assistantMessage.content)).toHaveCount(0);
});
test("GET correlates a persisted user by clientMessageId while POST is still pending", async ({ page }) => {
  const h = await setup(page);
  const pending = await h.send(h.first, "服务端已保存但回复尚未返回");
  const payload = reply(h.first, pending.body);
  h.history.set(h.first.conversationId, [payload.userMessage]);
  await h.select(h.second);
  const held = h.holdHistory(h.first, [payload.userMessage]);
  await h.select(h.first);
  await held.started.promise;
  await expectPending(page, pending.body.content);
  await releaseHistory(page, h.first.conversationId, held);
  await expect(bubble(page, pending.body.content)).toHaveCount(1);
  await expect(bubble(page, pending.body.content).getByRole("button", { name: "标记为重要消息", exact: true })).toBeEnabled();
  await expect(typing(page)).toHaveText("对方正在输入…");
  await h.succeed(h.first, pending);
  await expect(bubble(page, payload.assistantMessage.content)).toBeVisible();
  await expect(page.getByLabel("聊天记录").locator("article.message")).toHaveCount(2);
  await expect(bubble(page, pending.body.content)).toHaveCount(1);
  await expect(typing(page)).toHaveCount(0);
});
for (const releaseWhen of ["pending", "replied"] as const) {
  test(`stale GET released when ${releaseWhen} cannot erase the optimistic send or new reply`, async ({ page }) => {
    const h = await setup(page);
    await h.select(h.second);
    const held = h.holdHistory(h.first, []);
    await h.select(h.first);
    await held.started.promise;
    const pending = await h.send(h.first, "比历史快照更新的消息");
    if (releaseWhen === "pending") {
      await releaseHistory(page, h.first.conversationId, held);
      await expectPending(page, pending.body.content);
    }
    const payload = await h.succeed(h.first, pending);
    await expect(bubble(page, payload.assistantMessage.content)).toBeVisible();
    if (releaseWhen === "replied") await releaseHistory(page, h.first.conversationId, held);
    await expect(bubble(page, pending.body.content)).toHaveCount(1);
    await expect(bubble(page, payload.assistantMessage.content)).toHaveCount(1);
    await expect(page.getByLabel("聊天记录").locator("article.message")).toHaveCount(2);
    await expect(typing(page)).toHaveCount(0);
  });
}
