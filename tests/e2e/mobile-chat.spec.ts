import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect, test, type Page } from "./fixtures";
import type { CompanionProfile, MessageRecord } from "../../src/lib/renewal/types";
import type { GroupResult } from "../../src/lib/groups/types";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test.setTimeout(90_000);

async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}
async function setup(api: APIRequestContext) {
  const login = await api.post("/api/auth/login", { data: {
    email: `mobile-chat-${crypto.randomUUID()}@perpetual-renewal.local`, nickname: "手机布局验收"
  } });
  const session = await json<{ session: { provider: string } }>(login);
  expect(session.session.provider).toBe("local-email");
  const config = await json<{ configStatus: { items: Array<{ id: string; status: string }> } }>(await api.get("/api/me/config-status"));
  expect(config.configStatus.items.find(item => item.id === "llm_key")?.status).toBe("missing");
  const origin = new URL(login.url()).origin;
  const post = (path: string, data: unknown) => api.post(path, { data, headers: { origin } });
  const people: CompanionProfile[] = [];
  for (const name of ["灯下甲", "灯下乙", "灯下丙"]) people.push((await json<{ companion: CompanionProfile }>(await post("/api/companions", {
    name, relationshipKind: "CUSTOM", customKind: "朋友", speakingStyle: "简短自然。", proactiveMessagesEnabled: false
  }), 201)).companion);
  return { people, post };
}
async function bounds(page: Page) {
  return page.getByLabel("群聊天记录", { exact: true }).evaluate(node => {
    const main = node.parentElement!;
    const header = main.querySelector("header")!.getBoundingClientRect();
    const composer = main.querySelector("form")!.getBoundingClientRect();
    const log = node.getBoundingClientRect();
    return { headerBottom: header.bottom, top: log.top, bottom: log.bottom, height: log.height,
      composerTop: composer.top, composerBottom: composer.bottom, viewport: window.visualViewport?.height ?? innerHeight,
      pageWidth: document.documentElement.scrollWidth, screenWidth: innerWidth };
  });
}

test("mobile group keeps history clear of long details, composer, member picker and resized viewport", async ({ page }) => {
  const { people, post } = await setup(page.request);
  const group = (await json<GroupResult>(await post("/api/groups", {
    name: "一个很长的群名称用于验证窄屏幕下不会挤掉消息区域".repeat(2),
    background: "这是一段较长的群聊背景，应该按需展开，不能盖住聊天记录。".repeat(90), companionIds: people.map(p => p.id)
  }))).group;
  for (let i = 0; i < 10; i++) await json(await post(`/api/groups/${group.id}`, {
    action: "message", content: `第 ${i} 段记录：${"旧城灯下的对话。".repeat(20)}`, clientId: crypto.randomUUID()
  }));
  await page.goto(`/groups/${group.id}`);
  const log = page.getByLabel("群聊天记录", { exact: true });
  await expect(log.getByText("第 9 段记录：", { exact: false })).toBeVisible();
  const details = page.locator("details").filter({ has: page.locator("summary").getByText(/群简介/) });
  await expect(details).not.toHaveAttribute("open", "");
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 390, height: 420 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => (await bounds(page)).composerBottom).toBeLessThanOrEqual(size.height + 1);
    let box = await bounds(page);
    expect(box.top).toBeGreaterThanOrEqual(box.headerBottom - 1);
    expect(box.bottom).toBeLessThanOrEqual(box.composerTop + 1);
    expect(box.height).toBeGreaterThan(90);
    expect(box.pageWidth).toBeLessThanOrEqual(box.screenWidth);
    await details.locator("summary").click();
    box = await bounds(page);
    expect(box.height).toBeGreaterThan(50);
    expect(box.bottom).toBeLessThanOrEqual(box.composerTop + 1);
    await details.locator("summary").click();
    await page.getByRole("button", { name: "＠ 选择成员", exact: true }).click();
    box = await bounds(page);
    expect(box.height).toBeGreaterThan(50);
    expect(box.composerBottom).toBeLessThanOrEqual(size.height + 1);
    await page.getByRole("button", { name: "完成选择", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Mobile keyboards can shrink visualViewport without resizing the layout viewport.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 420 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect.poll(async () => (await bounds(page)).composerBottom).toBeLessThanOrEqual(421);
  expect((await bounds(page)).height).toBeGreaterThan(90);
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport!, "height");
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await log.evaluate(node => { node.scrollTop = 0; });
  await expect(log.getByText("第 0 段记录：", { exact: false })).toBeInViewport();
  await page.getByRole("button", { name: "成员与设置", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "成员与群设置", exact: true });
  await expect(panel).toBeInViewport();
  await panel.getByRole("button", { name: "关闭面板", exact: true }).click();
  await expect.poll(() => log.evaluate(node => node.scrollTop)).toBeLessThan(3);
  await log.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(log.getByText("第 9 段记录：", { exact: false })).toBeInViewport();
  await page.screenshot({ path: "design/previews/2026-11-18/mobile-group-layout.png", animations: "disabled" });
});

test("opening the already-selected contact clears its badge immediately on a mobile browser without focus", async ({ page }) => {
  const { people, post } = await setup(page.request);
  const person = people[0];
  const sent = await json<{ assistantMessage: MessageRecord; completion: { provider: string } }>(await post(`/api/conversations/${person.conversationId}/messages`, {
    content: "手机打开联系人前的一条未读", clientMessageId: crypto.randomUUID()
  }), 201);
  expect(sent.completion.provider).toBe("mock");
  await page.addInitScript(() => Object.defineProperty(document, "hasFocus", { value: () => false }));
  await page.goto(`/?companion=${person.id}`);
  // Start on the list with this person already selected, so opening only changes visibility.
  const back = page.getByRole("button", { name: "返回联系人", exact: true });
  await expect(page.locator(".companion-heading").getByRole("heading")).toHaveText(person.name);
  await expect(back).toBeVisible();
  await back.click();
  const contact = page.getByTitle(`切换到 ${person.name}`, { exact: true });
  await expect(contact).toBeVisible();
  // Recreate an unread message while the conversation is hidden.
  await json(await post(`/api/conversations/${person.conversationId}/messages`, {
    content: "列表期间的新未读", clientMessageId: crypto.randomUUID()
  }), 201);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(contact.locator(".unread-badge")).toBeVisible();
  const receipt = page.waitForResponse(response => new URL(response.url()).pathname === "/api/sync/read" && response.request().method() === "POST", { timeout: 5000 });
  await contact.click();
  expect((await receipt).status()).toBe(200);
  await expect(page.getByLabel("聊天记录", { exact: true })).toBeVisible();
  await expect(contact.locator(".unread-badge")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 420 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => page.locator(".composer").evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(421);
  const layout = await page.getByLabel("聊天记录", { exact: true }).evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return { height: bounds.height, bottom: bounds.bottom, composerTop: document.querySelector(".composer")!.getBoundingClientRect().top };
  });
  expect(layout.height).toBeGreaterThan(80);
  expect(layout.bottom).toBeLessThanOrEqual(layout.composerTop + 1);
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport!, "height");
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await back.click();
  await expect(contact).toBeVisible();
  await expect(contact.locator(".unread-badge")).toHaveCount(0);
});

test("mobile group unread stays cleared after reading and returning to the list", async ({ page }) => {
  const { people, post } = await setup(page.request);
  const group = (await json<GroupResult>(await post("/api/groups", { name: "手机未读验收", companionIds: [people[0].id] }))).group;
  const sent = await json<GroupResult>(await post(`/api/groups/${group.id}`, {
    action: "message", content: "灯下聊一会", mentionIds: [people[0].id], clientId: crypto.randomUUID()
  }));
  const replied = await json<GroupResult>(await post(`/api/groups/${group.id}`, { action: "reply", turn: sent.group.turn, speakerId: people[0].id }));
  expect(replied.source).toBe("local");
  await page.addInitScript(() => Object.defineProperty(document, "hasFocus", { value: () => false }));
  await page.goto("/groups");
  const link = page.getByRole("link", { name: new RegExp(group.name) });
  await expect(link.getByLabel("1 条未读", { exact: true })).toBeVisible();
  await link.click();
  await expect(page.getByLabel("群聊天记录", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const data = await json<{ threads: Array<{ scope: string; threadId: string; unreadCount: number }> }>(await page.request.get("/api/sync/inbox"));
    return data.threads.find(row => row.scope === "group" && row.threadId === group.id)?.unreadCount;
  }).toBe(0);
  await page.getByRole("link", { name: "全部群聊", exact: true }).click();
  await expect(link).toBeVisible();
  await expect(link.locator(".unread-badge")).toHaveCount(0);
});
