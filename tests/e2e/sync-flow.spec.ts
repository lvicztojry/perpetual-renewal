import type { APIRequestContext, APIResponse, Browser } from "@playwright/test";
import { expect, test, type Page } from "./fixtures";
import type { CompanionProfile, MessageRecord } from "../../src/lib/renewal/types";
import type { GroupResult } from "../../src/lib/groups/types";

// Run only against the controller's isolated local-email / memory / mock app.
// No route interception, server startup, environment reads, or persisted storageState.
test.use({ showIntro: false });
test.setTimeout(90_000);
type Scope = "private" | "group";
type Inbox = { userId: string; threads: Array<{ scope: Scope; threadId: string; unreadCount: number }>; checkedAt: string };
type Sent = { userMessage: MessageRecord; assistantMessage: MessageRecord; completion: { provider: string } };
const origins = new WeakMap<APIRequestContext, string>();
const composer = (page: Page) => page.getByRole("textbox", { name: "把想说的话放在这里", exact: true });
const stream = (page: Page) => page.getByLabel("聊天记录", { exact: true });
const bubble = (page: Page, content: string) => stream(page).locator("article.message")
  .filter({ has: page.locator(".message-bubble").getByText(content, { exact: true }) });
const contact = (page: Page, person: CompanionProfile) => page.getByTitle(`切换到 ${person.name}`, { exact: true });
async function json<T>(response: Pick<APIResponse, "status" | "url" | "json">, status = 200): Promise<T> {
  // Never dump response bodies, headers, cookies or credentials on failure.
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}
function post(api: APIRequestContext, path: string, data: unknown) {
  const origin = origins.get(api);
  if (!origin) throw new Error("Missing isolated origin");
  return api.post(path, { data, headers: { origin } });
}
async function login(api: APIRequestContext, email = `sync-${crypto.randomUUID()}@perpetual-renewal.local`) {
  const response = await api.post("/api/auth/login", { data: { email, nickname: "同步隔离验收" } });
  origins.set(api, new URL(response.url()).origin);
  const result = await json<{ session: { provider: string; userId: string } }>(response);
  expect(result.session.provider).toBe("local-email");
  expect(result.session.userId).toMatch(/^memory-user-/);
  const readiness = await json<{ configStatus: { items: Array<{ id: string; status: string }> } }>(
    await api.get("/api/me/config-status"));
  expect(readiness.configStatus.items.find(item => item.id === "llm_key")?.status,
    "Controller must clear provider credentials on the isolated app").toBe("missing");
  return { email, userId: result.session.userId };
}
async function person(api: APIRequestContext, name: string) {
  return (await json<{ companion: CompanionProfile }>(await post(api, "/api/companions", {
    name, relationshipKind: "CUSTOM", customKind: "同步验收", speakingStyle: "简短自然",
    proactiveMessagesEnabled: false, immersionEnabled: true
  }), 201)).companion;
}
async function setup(page: Page) {
  const account = await login(page.request);
  const first = await person(page.request, "同步甲");
  const second = await person(page.request, "同步乙");
  return { account, first, second };
}
async function select(page: Page, who: CompanionProfile) {
  await contact(page, who).click();
  await expect(page.locator(".companion-heading").getByRole("heading")).toHaveText(who.name);
  await expect(composer(page)).toBeVisible();
  await expect(stream(page)).toHaveAttribute("aria-busy", "false");
}
async function wake(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => {
    window.focus();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
}
async function refresh(page: Page, path: string) {
  const received = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === path);
  await wake(page);
  const response = await received;
  expect(response.status(), path).toBe(200);
  await response.finished();
}
async function inbox(api: APIRequestContext) {
  const response = await api.get("/api/sync/inbox");
  expect(response.headers()["cache-control"]).toContain("no-store");
  const result = await json<Inbox>(response);
  expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
  return result;
}
async function count(api: APIRequestContext, scope: Scope, threadId: string) {
  const row = (await inbox(api)).threads.find(t => t.scope === scope && t.threadId === threadId);
  expect(Boolean(row), "Expected thread in inbox").toBe(true);
  return row!.unreadCount;
}
const messagesPath = (who: CompanionProfile) => `/api/conversations/${who.conversationId}/messages`;
async function send(api: APIRequestContext, who: CompanionProfile, content: string) {
  const result = await json<Sent>(await post(api, messagesPath(who), { content, clientMessageId: crypto.randomUUID() }), 201);
  expect(result.completion?.provider, "Private replies must use mock").toBe("mock");
  expect(result.assistantMessage.role).toBe("assistant");
  expect(result.assistantMessage.metadata?.status).toBe("sent");
  return result;
}
async function withPhone(browser: Browser, page: Page, run: (phone: Page) => Promise<void>) {
  const baseURL = new URL(page.url()).origin;
  const context = await browser.newContext({
    baseURL, storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
  });
  try {
    origins.set(context.request, baseURL);
    await context.addInitScript(() => {
      sessionStorage.setItem("renewal:intro-seen:v1", "1");
      sessionStorage.setItem("renewal:journey-suppress:v1", "1");
    });
    await run(await context.newPage());
  } finally { await context.close(); }
}
test.beforeEach(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL!).hostname);
});

test("phone focus imports remote sends/deletes while preserving the unsent draft", async ({ page, browser }) => {
  const { first } = await setup(page);
  await page.goto("/"); await select(page, first);
  await withPhone(browser, page, async phone => {
    await phone.goto("/"); await select(phone, first);
    await composer(phone).fill("手机上未发送的草稿");
    await wake(page);
    const content = "从桌面发给另一端的消息";
    const received = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === messagesPath(first));
    await composer(page).fill(content);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const sent = await json<Sent>(await received, 201);
    expect(sent.completion?.provider).toBe("mock");
    await refresh(phone, messagesPath(first));
    await expect(bubble(phone, content)).toHaveCount(1);
    await expect(bubble(phone, sent.assistantMessage.content)).toBeVisible();
    await expect(composer(phone)).toHaveValue("手机上未发送的草稿");
    await json(await page.request.delete(`${messagesPath(first)}?messageId=${encodeURIComponent(sent.userMessage.id)}`));
    await refresh(phone, messagesPath(first));
    await expect(bubble(phone, content)).toHaveCount(0);
    await expect(composer(phone)).toHaveValue("手机上未发送的草稿");
  });
});

test("remote updates preserve a scrolled-up position and do not acknowledge unseen incoming IDs", async ({ page }) => {
  const { first } = await setup(page);
  for (let i = 0; i < 12; i++) await send(page.request, first, `历史段落${i}：${"这是一段用于滚动验收的历史。".repeat(35)}`);
  await page.goto("/"); await select(page, first); await wake(page);
  await stream(page).evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
  await expect.poll(async () => { await wake(page); return count(page.request, "private", first.conversationId); }).toBe(0);
  await composer(page).fill("阅读旧消息时的草稿");
  await stream(page).evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
  await expect.poll(() => stream(page).evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
  const sent = await send(page.request, first, "上翻期间另一端新增的消息");
  await refresh(page, messagesPath(first));
  await expect(bubble(page, sent.userMessage.content)).toHaveCount(1);
  await expect(bubble(page, sent.assistantMessage.content)).toHaveCount(1);
  await expect.poll(() => stream(page).evaluate(el => el.scrollTop)).toBeLessThan(3);
  await expect(composer(page)).toHaveValue("阅读旧消息时的草稿");
  expect(await count(page.request, "private", first.conversationId)).toBe(1);
  await stream(page).evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
  await expect.poll(async () => { await wake(page); return count(page.request, "private", first.conversationId); }).toBe(0);
});

test("inactive contact badge survives the phone contact list and clears across contexts on open", async ({ page, browser }) => {
  const { first, second } = await setup(page);
  await page.goto("/"); await select(page, first);
  await withPhone(browser, page, async phone => {
    await phone.goto("/");
    await expect(contact(phone, second)).toBeVisible();
    await send(page.request, second, "只应在乙联系人显示的未读");
    await refresh(page, "/api/sync/inbox");
    await expect(contact(page, second).getByLabel("1 条未读", { exact: true })).toBeVisible();
    await page.screenshot({ path: "design/previews/2026-11-17/sync-desktop.png", fullPage: true, animations: "disabled" });
    await refresh(phone, "/api/sync/inbox");
    await expect(contact(phone, second).getByLabel("1 条未读", { exact: true })).toBeVisible();
    await phone.screenshot({ path: "design/previews/2026-11-17/sync-mobile.png", fullPage: true, animations: "disabled" });
    expect(await count(phone.request, "private", second.conversationId)).toBe(1);
    expect(await count(page.request, "private", second.conversationId)).toBe(1);
    await expect(composer(phone)).not.toBeVisible();
    await select(phone, second);
    await expect.poll(async () => { await wake(phone); return count(phone.request, "private", second.conversationId); }).toBe(0);
    await refresh(page, "/api/sync/inbox");
    await expect(contact(page, second).getByLabel(/条未读/)).toHaveCount(0);
    expect(await count(page.request, "private", second.conversationId)).toBe(0);
  });
});

test("account mismatch gates the old workspace; returning to its account restores its draft", async ({ page }) => {
  const { account, first } = await setup(page);
  await page.goto("/"); await select(page, first);
  await composer(page).fill("只属于原账号的未发送输入");
  const other = await login(page.request);
  expect(other.userId === account.userId).toBe(false);
  await refresh(page, "/api/sync/inbox");
  await expect(page.getByRole("heading", { name: "账号已切换", exact: true })).toBeVisible();
  await expect(composer(page)).not.toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).not.toBeVisible();
  expect((await inbox(page.request)).userId === other.userId).toBe(true);
  await login(page.request, account.email);
  await refresh(page, "/api/sync/inbox");
  await expect(page.getByRole("heading", { name: "账号已切换", exact: true })).toHaveCount(0);
  await expect(composer(page)).toHaveValue("只属于原账号的未发送输入");
  await expect(page.locator(".companion-heading").getByRole("heading")).toHaveText(first.name);
});

test("group inbox/ack is exact, atomic, idempotent, owner-scoped, capped and same-origin", async ({ page, playwright, baseURL }) => {
  const { first } = await setup(page);
  const created = await json<GroupResult>(await post(page.request, "/api/groups", {
    name: "同步已读群", background: "本地验收", companionIds: [first.id]
  }));
  const groupPath = `/api/groups/${created.group.id}`;
  const sent = await json<GroupResult>(await post(page.request, groupPath, {
    action: "message", content: "群内同步消息", clientId: crypto.randomUUID(), mentionIds: [first.id]
  }));
  const incoming: string[] = [];
  for (const content of ["第二轮之前的回复", "另一条未读回复"]) {
    const turn = content.startsWith("第二") ? sent : await json<GroupResult>(await post(page.request, groupPath, {
      action: "message", content, clientId: crypto.randomUUID(), mentionIds: [first.id]
    }));
    const reply = await json<GroupResult>(await post(page.request, groupPath, {
      action: "reply", turn: turn.group.turn, speakerId: first.id
    }));
    expect(reply.source).toBe("local");
    incoming.push(reply.group.messages[reply.group.messages.length - 1].id);
  }
  expect(await count(page.request, "group", created.group.id)).toBe(2);
  const body = { scope: "group", threadId: created.group.id, messageIds: incoming };
  // A mixed valid/unknown batch must not partially acknowledge the valid ID.
  await json(await post(page.request, "/api/sync/read", { ...body, messageIds: [incoming[0], "unknown-sync-id"] }), 404);
  expect(await count(page.request, "group", created.group.id)).toBe(2);
  await json(await post(page.request, "/api/sync/read", { ...body, messageIds: Array(201).fill(incoming[0]) }), 400);
  await json(await page.request.post("/api/sync/read", { data: body, headers: { origin: "https://cross-site.invalid" } }), 403);
  await json(await post(page.request, "/api/sync/read", { ...body, scope: "private" }), 404);
  await json(await post(page.request, "/api/sync/read", { ...body, messageIds: [sent.group.messages[0].id] }), 404);
  expect(await count(page.request, "group", created.group.id)).toBe(2);
  const stranger = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    await login(stranger);
    expect((await inbox(stranger)).threads.some(t => t.threadId === created.group.id)).toBe(false);
    await json(await post(stranger, "/api/sync/read", body), 404);
  } finally { await stranger.dispose(); }
  expect(await json(await post(page.request, "/api/sync/read", { ...body, messageIds: Array(200).fill(incoming[0]) })))
    .toEqual({ markedCount: 1 });
  expect(await count(page.request, "group", created.group.id)).toBe(1);
  expect(await json(await post(page.request, "/api/sync/read", body))).toEqual({ markedCount: 1 });
  expect(await json(await post(page.request, "/api/sync/read", body))).toEqual({ markedCount: 0 });
  expect(await count(page.request, "group", created.group.id)).toBe(0);
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("a real pre-send GET released after POST cannot erase the new user/AI pair", async ({ page }) => {
  const { first } = await setup(page);
  await page.goto("/"); await select(page, first);
  const pattern = `**${messagesPath(first)}`;
  const captured = deferred<{ messages: MessageRecord[] }>();
  const releaseOld = deferred<void>();
  const releaseLater = deferred<void>();
  let held = false;
  // Only response ordering is controlled: the old snapshot comes from the real app.
  // Later GETs cannot repair a stale overwrite during assertions, even on a slow CI host.
  const handler: Parameters<Page["route"]>[1] = async route => {
    if (route.request().method() !== "GET") { await route.continue(); return; }
    if (held) {
      await releaseLater.promise;
      if (!route.request().failure()) await route.continue().catch(() => undefined);
      return;
    }
    held = true;
    const response = await route.fetch();
    captured.resolve(await response.json());
    await releaseOld.promise;
    await route.fulfill({ response });
  };
  await page.route(pattern, handler);
  try {
    await wake(page);
    expect((await captured.promise).messages).toEqual([]);
    const content = "旧快照之后正常发送的新消息";
    const posted = page.waitForResponse(r => r.request().method() === "POST" &&
      new URL(r.url()).pathname === messagesPath(first));
    await composer(page).fill(content);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const result = await json<Sent>(await posted, 201);
    expect(result.completion?.provider).toBe("mock");
    await expect(bubble(page, content)).toHaveCount(1);
    await expect(bubble(page, result.assistantMessage.content)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await composer(page).fill("POST 后继续输入的草稿");
    const oldArrived = page.waitForResponse(r => r.request().method() === "GET" &&
      new URL(r.url()).pathname === messagesPath(first));
    releaseOld.resolve();
    await (await oldArrived).finished();
    await page.evaluate(() => new Promise<void>(done =>
      requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    // One-shot assertions after response/render: no automatic retry or 7s poll rescue.
    expect(await bubble(page, content).count()).toBe(1);
    expect(await bubble(page, result.assistantMessage.content).count()).toBe(1);
    expect(await stream(page).locator("article.message").count()).toBe(2);
    expect(await composer(page).inputValue()).toBe("POST 后继续输入的草稿");
  } finally {
    releaseOld.resolve();
    releaseLater.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});


