import type { APIRequestContext, APIResponse } from "@playwright/test";
import path from "node:path";
import { test, expect } from "./fixtures";
import type { JourneyInput, JourneyResponse } from "../../src/lib/journey/types";

// The controller supplies an isolated memory/local-email server with dummy LLM.
// Native QA additionally covers registration and old encrypted snapshots.
test.use({ showJourney: true, showIntro: false });
const origins = new WeakMap<APIRequestContext, string>();

async function json<T>(response: Pick<APIResponse, "status" | "url" | "json">, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}

async function login(api: APIRequestContext) {
  const response = await api.post("/api/auth/login", {
    data: { email: `journey-${crypto.randomUUID()}@perpetual-renewal.local`, nickname: "引导验收" }
  });
  origins.set(api, new URL(response.url()).origin);
  const result = await json<{ session: { userId: string; provider: string } }>(response);
  expect(result.session.provider).toBe("local-email");
  expect(result.session.userId).toMatch(/^memory-user-/);
  const config = await json<{ configStatus: { items: Array<{ id: string; status: string }> } }>(await api.get("/api/me/config-status"));
  expect(config.configStatus.items.find(item => item.id === "llm_key")?.status).toBe("missing");
  return result.session.userId;
}

async function read(api: APIRequestContext) {
  return json<JourneyResponse>(await api.get("/api/me/journey"));
}

async function act(api: APIRequestContext, input: JourneyInput) {
  return json<JourneyResponse>(await api.post("/api/me/journey", {
    headers: { origin: origins.get(api)! },
    data: input
  }));
}

async function snapshot(api: APIRequestContext) {
  const people = await json<{ companions: Array<{ id: string; conversationId: string }> }>(await api.get("/api/companions"));
  return Promise.all(people.companions.map(async person => ({
    person,
    messages: await json(await api.get(`/api/conversations/${person.conversationId}/messages`)),
    memories: await json(await api.get(`/api/companions/${person.id}/memories`)),
    dream: await json(await api.get(`/api/companions/${person.id}/dream`))
  })));
}

test.beforeEach(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL!).hostname);
  expect(process.env.E2E_REAL_PROVIDER).not.toBe("1");
  expect(process.env.E2E_REPOSITORY ?? "memory").toBe("memory");
  expect(process.env.E2E_AUTH_MODE ?? "local-email").toBe("local-email");
});

test("journey requires authentication and trusted origin; stale progress cannot overwrite a pause", async ({ request, baseURL }) => {
  expect((await request.get("/api/me/journey")).status()).toBe(401);
  await login(request);
  const initial = await read(request);
  expect(initial.journey).toMatchObject({ version: 1, status: "active", step: "awakening", companionId: null, revision: 0 });
  const untrustedHeaders: Array<Record<string, string>> = [{}, { origin: "https://untrusted.invalid" }];
  for (const headers of untrustedHeaders) {
    expect((await request.post("/api/me/journey", { headers, data: { action: "start", expectedRevision: 0 } })).status()).toBe(403);
  }
  expect(await read(request)).toEqual(initial);
  const started = await act(request, { action: "start", expectedRevision: 0 });
  const advanced = await act(request, { action: "advance", expectedRevision: started.journey.revision });
  const paused = await act(request, { action: "pause", expectedRevision: advanced.journey.revision });
  expect(paused.journey).toMatchObject({ status: "paused", step: "arrival" });
  const stale = await json<JourneyResponse>(await request.post("/api/me/journey", {
    headers: { origin: new URL(baseURL!).origin }, data: { action: "skip", expectedRevision: advanced.journey.revision }
  }), 409);
  expect(stale.journey).toEqual(paused.journey);
  expect(await read(request)).toEqual(paused);
});

test("observed milestones require owned persisted resources and survive explicit replay", async ({ request, playwright, baseURL }) => {
  const userId = await login(request);
  const other = await playwright.request.newContext({ baseURL });
  try {
    await login(other);
    const foreign = await json<{ companion: { id: string } }>(await other.post("/api/companions", {
      data: { name: "别人的人物", relationshipKind: "FRIEND", speakingStyle: "简短自然", proactiveMessagesEnabled: false }
    }), 201);
    let current = await act(request, { action: "start", expectedRevision: 0 });
    for (let i = 0; i < 3; i++) current = await act(request, { action: "advance", expectedRevision: current.journey.revision });
    expect(current.journey.step).toBe("creation");
    const origin = new URL(baseURL!).origin;
    const observe = (kind: string, companionId: string) => request.post("/api/me/journey", {
      headers: { origin }, data: { action: "observe", kind, companionId, expectedRevision: current.journey.revision }
    });
    expect((await observe("companion-created", foreign.companion.id)).status()).toBe(404);
    expect(await read(request)).toEqual(current);
    const created = await json<{ companion: { id: string; conversationId: string } }>(await request.post("/api/companions", {
      data: { name: "引导留下的人物", relationshipKind: "FRIEND", speakingStyle: "简短自然", proactiveMessagesEnabled: false }
    }), 201);
    const person = created.companion;
    current = await json<JourneyResponse>(await observe("companion-created", person.id));
    expect(current).toMatchObject({ userId, journey: { step: "conversation", companionId: person.id } });
    expect((await observe("message-sent", person.id)).status()).toBe(400);
    expect(await read(request)).toEqual(current);
    await json(await request.post(`/api/conversations/${person.conversationId}/messages`, {
      data: { content: "你好，我会慢慢认识你。", clientMessageId: `journey-${crypto.randomUUID()}` }
    }), 201);
    current = await json<JourneyResponse>(await observe("message-sent", person.id));
    expect(current.journey.step).toBe("dream");
    expect((await observe("dream-started", person.id)).status()).toBe(400);
    expect(await read(request)).toEqual(current);
    await json(await request.post(`/api/companions/${person.id}/dream`, { headers: { origin }, data: { action: "start" } }));
    current = await json<JourneyResponse>(await observe("dream-started", person.id));
    expect(current.journey).toMatchObject({ status: "completed", step: "complete" });
    const before = await snapshot(request);
    current = await act(request, { action: "start", expectedRevision: current.journey.revision });
    expect(current.journey).toMatchObject({ status: "active", step: "awakening", companionId: null });
    await act(request, { action: "skip", expectedRevision: current.journey.revision });
    expect(await snapshot(request)).toEqual(before);
    expect((await read(other)).journey).toMatchObject({ status: "active", revision: 0 });
  } finally { await other.dispose(); }
});

test("new user automatically enters the story, pauses and resumes after reload, then creates, chats and enters a persisted dream", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page.request);
  await page.goto("/");
  const guide = page.locator("[data-journey-dialog]");
  const bar = page.getByRole("complementary", { name: "余念安同行", exact: true });
  await expect(guide).toBeVisible();
  expect((await read(page.request)).journey.status).toBe("active");
  const before = await snapshot(page.request);
  await expect(guide.getByRole("img")).toHaveAttribute("src", "/visuals/yu-nianan-guide.png");
  await expect(guide.getByRole("heading")).toHaveText("初醒 · 有人等你");
  await guide.getByRole("img").evaluate(async node => {
    if (node instanceof HTMLImageElement) await node.decode();
  });
  for (const [width, height, kind] of [[1365, 900, "desktop"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    const bounds = await guide.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
    expect(await guide.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.resolve(`design/previews/2026-11-23/journey-initial-${kind}.png`) });
  }
  // A scripted answer is deliberately local; no chat is sent to the guide.
  await guide.getByRole("button", { name: "暂时不想说", exact: true }).click();
  await expect(guide).toContainText("名字和往事，都可以留在你心里");
  await guide.getByRole("button", { name: "随她走进旧城", exact: true }).click();
  await expect(guide.getByRole("heading")).toHaveText("旧城 · 久别重逢");
  await guide.getByRole("button", { name: "暂歇片刻", exact: true }).click();
  await expect(guide).toBeHidden();
  const paused = await read(page.request);
  expect(paused.journey).toMatchObject({ status: "paused", step: "arrival" });
  expect(await snapshot(page.request)).toEqual(before);
  await page.reload();
  await expect(page.getByRole("button", { name: "找余念安", exact: true }).first()).toBeVisible();
  await expect(guide).toBeHidden();
  expect(await read(page.request)).toEqual(paused);
  await page.getByRole("button", { name: "找余念安", exact: true }).first().click();
  await guide.getByRole("button", { name: "接着走", exact: true }).click();
  await expect(guide.getByRole("heading")).toHaveText("旧城 · 久别重逢");
  await guide.getByRole("button", { name: "去听听城里的声音", exact: true }).click();
  await expect(guide.getByRole("heading")).toHaveText("留灯 · 人间尚暖");
  await guide.getByRole("button", { name: "去看看那盏灯", exact: true }).click();
  await expect(page).toHaveURL(/\/groups\/starter-/);
  await expect(bar).toContainText("描摹 · 想见的人");
  const starters = await json<{ companions: Array<{ id: string }> }>(await page.request.get("/api/companions"));
  expect(starters.companions).toHaveLength(6);
  await bar.getByRole("button", { name: "继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "创建关系对象", exact: true })).toBeVisible();
  const name = `归灯${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("名字", { exact: true }).fill(name);
  await page.getByLabel("具体关系", { exact: true }).fill("久别重逢的朋友");
  await page.getByLabel("性格关键词", { exact: true }).fill("平实、耐心");
  await page.getByLabel("语气", { exact: true }).fill("简短自然");
  const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/companions" && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建并开始聊天", exact: true }).last().click();
  const created = await json<{ companion: { id: string; conversationId: string } }>(await createdResponse, 201);
  const person = created.companion;
  await expect.poll(async () => (await read(page.request)).journey).toMatchObject({ step: "conversation", companionId: person.id });
  await expect(bar).toContainText("回声 · 说给你听");
  const words = "你好，我们可以从今天的小事说起。";
  await page.getByPlaceholder("把想说的话放在这里").fill(words);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(async () => (await read(page.request)).journey.step).toBe("dream");
  const saved = await json<{ messages: Array<{ role: string; content: string }> }>(await page.request.get(`/api/conversations/${person.conversationId}/messages`));
  expect(saved.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user", content: words })]));
  await bar.getByRole("button", { name: "继续", exact: true }).click();
  await expect(page).toHaveURL(`/dream/${person.id}`);
  // Navigation alone is not evidence that the dream exists.
  expect((await read(page.request)).journey.step).toBe("dream");
  await page.getByRole("button", { name: "进入梦境", exact: true }).click();
  const intro = page.getByRole("dialog", { name: "入梦开场", exact: true });
  if (await intro.isVisible()) await intro.getByRole("button", { name: "跳过开场动画", exact: true }).click();
  await expect.poll(async () => (await read(page.request)).journey).toMatchObject({ status: "completed", step: "complete", companionId: person.id });
  const dream = await json<{ state: { companionId: string } | null }>(await page.request.get(`/api/companions/${person.id}/dream`));
  expect(dream.state?.companionId).toBe(person.id);
  const completedResources = await snapshot(page.request);
  await page.goto("/");
  await page.getByRole("button", { name: "找余念安", exact: true }).first().click();
  await guide.getByRole("button", { name: "重返初醒", exact: true }).click();
  await guide.getByRole("button", { name: "我想自行走走", exact: true }).click();
  await expect(guide).toBeHidden();
  expect((await read(page.request)).journey.status).toBe("skipped");
  expect(await snapshot(page.request)).toEqual(completedResources);
});
