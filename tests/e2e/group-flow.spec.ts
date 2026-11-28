import type { APIRequestContext, APIResponse } from "@playwright/test";
import process from "node:process";
import { expect, test, type Page } from "./fixtures";
import type { CompanionProfile } from "../../src/lib/renewal/types";
import type { GroupAction, GroupResult, GroupSummary } from "../../src/lib/groups/types";

// The controller owns the isolated local-email / memory server with LLM keys cleared.
// This suite neither starts a server nor calls a real provider.
test.use({ showIntro: false });
const origins = new WeakMap<APIRequestContext, string>();

test("background group scheduler rejects missing or invalid cron authorization", async ({ request }) => {
  const endpoint = "/api/proactive/groups/run";
  await json(await request.get(endpoint), 401);
  const invalidAuthorization = ["Bearer", "invalid-test-authorization"].join(" ");
  const response = await request.get(endpoint, { headers: { authorization: invalidAuthorization } });
  await json(response, 401);
});
test.beforeEach(async ({ baseURL, request }) => {
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL!).hostname);
  origins.set(request, new URL(baseURL!).origin);
  expect(process.env.E2E_REAL_PROVIDER).not.toBe("1");
  expect(process.env.E2E_REPOSITORY ?? "memory").toBe("memory");
  expect(process.env.E2E_AUTH_MODE ?? "local-email").toBe("local-email");
});
async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  expect(response.headers()["cache-control"]).toContain("no-store");
  return response.json() as Promise<T>;
}
async function login(api: APIRequestContext) {
  const response = await api.post("/api/auth/login", {
    data: { email: `group-${crypto.randomUUID()}@perpetual-renewal.local`, nickname: "群聊隔离验收" }
  });
  origins.set(api, new URL(response.url()).origin);
  const result = await json<{ session: { provider: string; userId: string } }>(response);
  expect(result.session.provider).toBe("local-email");
  expect(result.session.userId).toMatch(/^memory-user-/);
  const readiness = await json<{ configStatus: { items: Array<{ id: string; status: string }> } }>(await api.get("/api/me/config-status"));
  expect(readiness.configStatus.items.find(item => item.id === "llm_key")?.status,
    "Controller must clear LLM keys before group generation").toBe("missing");
}
async function companion(api: APIRequestContext, name: string) {
  return (await json<{ companion: CompanionProfile }>(await api.post("/api/companions", { data: {
    name, relationshipKind: "CUSTOM", customKind: "群聊验收", personality: ["平实"],
    speakingStyle: "简短自然。", proactiveMessagesEnabled: false, immersionEnabled: true
  } }), 201)).companion;
}
function post(api: APIRequestContext, path: string, data: unknown) {
  const origin = origins.get(api);
  if (!origin) throw new Error("Group context has no local origin");
  return api.post(path, { data, headers: { origin } });
}
const path = (id: string) => `/api/groups/${id}`;
async function read(api: APIRequestContext, id: string) {
  return (await json<GroupResult>(await api.get(path(id)))).group;
}
async function act(api: APIRequestContext, id: string, action: GroupAction) {
  return json<GroupResult>(await post(api, path(id), action));
}
async function setup(api: APIRequestContext) {
  await login(api);
  const people = [await companion(api, "小林"), await companion(api, "小夏")];
  const group = (await json<GroupResult>(await post(api, "/api/groups", {
    name: "灯下验收", background: "两位朋友围坐聊天。", companionIds: people.map(p => p.id)
  }))).group;
  return { people, group };
}
function responseFor(page: Page, id: string, action: GroupAction["action"]) {
  return page.waitForResponse(r => new URL(r.url()).pathname === path(id) &&
    r.request().method() === "POST" && r.request().postDataJSON()?.action === action);
}

test("group messages persist immediately, replies arrive individually and clientId is idempotent", async ({ request }) => {
  const { people, group } = await setup(request);
  expect(group.members.map(m => m.companionId)).toEqual(people.map(p => p.id));
  expect(group.members.every(m => !m.allowPrivateMemories)).toBe(true);
  const action: GroupAction = { action: "message", content: "大家一起聊聊今天。", clientId: crypto.randomUUID(), mentionIds: people.map(p => p.id) };
  const sent = await act(request, group.id, action);
  expect(sent.group.messages).toHaveLength(1);
  expect(sent.group.messages[0]).toMatchObject({ content: action.content, clientId: action.clientId, speakerId: null });
  expect(sent.speakers).toHaveLength(2);
  expect(new Set(sent.speakers)).toEqual(new Set(people.map(p => p.id)));
  expect(await read(request, group.id)).toEqual(sent.group);
  expect((await act(request, group.id, action)).group).toEqual(sent.group);
  let latest = sent.group;
  for (const speakerId of sent.speakers!) {
    const reply = await act(request, group.id, { action: "reply", turn: sent.group.turn, speakerId });
    expect(reply.source).toBe("local");
    expect(reply.group.messages).toHaveLength(latest.messages.length + 1);
    expect(reply.group.messages.slice(0, -1)).toEqual(latest.messages);
    expect(reply.group.messages.at(-1)).toMatchObject({ speakerId, proactive: false });
    expect(reply.group.messages.at(-1)!.content.trim()).not.toBe("");
    latest = reply.group;
    expect(await read(request, group.id)).toEqual(latest);
  }
  expect((await act(request, group.id, action)).group).toEqual(latest);
  await json(await post(request, path(group.id), { ...action, content: "不能覆盖原消息" }), 409);
  expect(await read(request, group.id)).toEqual(latest);
  const listing = await json<{ groups: GroupSummary[] }>(await request.get("/api/groups"));
  expect(listing.groups).toEqual([expect.objectContaining({ id: group.id, lastMessage: latest.messages.at(-1) })]);
});

test("old turns and revisions reject with 409 without modifying the latest group", async ({ request }) => {
  const { people, group } = await setup(request);
  const first = await act(request, group.id, { action: "message", content: "第一轮", clientId: crypto.randomUUID(), mentionIds: [people[0].id] });
  const latest = await act(request, group.id, { action: "message", content: "新一轮打断", clientId: crypto.randomUUID(), mentionIds: [people[1].id] });
  await json(await post(request, path(group.id), { action: "reply", turn: first.group.turn, speakerId: people[0].id }), 409);
  await json(await post(request, path(group.id), { action: "update", revision: group.revision, name: "过期", background: "", members: group.members, settings: group.settings }), 409);
  expect(await read(request, group.id)).toEqual(latest.group);
});

test("settings, membership and confirmed group memories retain exact source and audience", async ({ request }) => {
  const { people, group } = await setup(request);
  const sent = await act(request, group.id, { action: "message", content: "周末一起在公园散步。", clientId: crypto.randomUUID() });
  const source = sent.group.messages[0];
  const remembered = (await act(request, group.id, { action: "remember", revision: sent.group.revision,
    content: "周末约好公园散步", sourceMessageIds: [source.id], knownBy: [people[0].id] })).group;
  expect(remembered.memories).toEqual([expect.objectContaining({ confirmed: true, sourceMessageIds: [source.id], knownBy: [people[0].id] })]);
  await json(await post(request, path(group.id), { action: "remember", revision: remembered.revision,
    content: "伪造来源", sourceMessageIds: [crypto.randomUUID()], knownBy: [people[0].id] }), 400);
  expect(await read(request, group.id)).toEqual(remembered);
  for (const person of people) {
    expect((await json<{ memories: unknown[] }>(await request.get(`/api/companions/${person.id}/memories`))).memories).toEqual([]);
  }
  const updated = (await act(request, group.id, { action: "update", revision: remembered.revision,
    name: "新的茶馆", background: "新约定", members: [{ ...remembered.members[0], relationship: "多年好友", allowPrivateMemories: true, proactiveEnabled: false }],
    settings: { ...remembered.settings, intervalMinutes: 20, maxReplies: 1, autoChat: true, maxAutoRounds: 2, quietStart: "22:30", quietEnd: "07:30" } })).group;
  expect(updated.members).toHaveLength(1);
  expect(updated.members[0]).toMatchObject({ companionId: people[0].id, relationship: "多年好友", allowPrivateMemories: true, proactiveEnabled: false });
  expect(updated.settings).toMatchObject({ intervalMinutes: 20, maxReplies: 1, autoChat: true, maxAutoRounds: 2, quietStart: "22:30", quietEnd: "07:30" });
  expect(await read(request, group.id)).toEqual(updated);
  const rejoined = (await act(request, group.id, { action: "update", revision: updated.revision,
    name: updated.name, background: updated.background, settings: updated.settings, members: [...updated.members, remembered.members[1]] })).group;
  expect(rejoined.members.map(m => m.companionId)).toEqual(people.map(p => p.id));
  await json(await post(request, path(group.id), { action: "remember", revision: rejoined.revision,
    content: "入群前不可知", sourceMessageIds: [source.id], knownBy: [people[1].id] }), 400);
  const forgotten = (await act(request, group.id, { action: "forget", revision: rejoined.revision, memoryId: remembered.memories[0].id })).group;
  expect(forgotten.memories).toEqual([]);
  await json(await request.delete(path(group.id), { headers: { origin: origins.get(request)! } }));
  await json(await request.get(path(group.id)), 404);
  expect((await json<{ groups: GroupSummary[] }>(await request.get("/api/groups"))).groups).toEqual([]);
});

test("group collection and detail require authentication for every method", async ({ request }) => {
  const id = crypto.randomUUID();
  for (const response of [await request.get("/api/groups"), await post(request, "/api/groups", {}),
    await request.get(path(id)), await post(request, path(id), { action: "proactive" }),
    await request.delete(path(id), { headers: { origin: origins.get(request)! } })]) {
    await json<{ error: string }>(response, 401);
  }
});

test("another account sees 404 for detail writes and deletion, and cannot invite foreign companions", async ({ playwright, baseURL }) => {
  const owner = await playwright.request.newContext({ baseURL });
  const stranger = await playwright.request.newContext({ baseURL });
  try {
    const { group, people } = await setup(owner);
    await login(stranger);
    expect((await json<{ groups: GroupSummary[] }>(await stranger.get("/api/groups"))).groups).toEqual([]);
    for (const method of ["get", "post", "delete"] as const) {
      const send = (id: string) => method === "post" ? post(stranger, path(id), { action: "proactive" })
        : method === "delete" ? stranger.delete(path(id), { headers: { origin: origins.get(stranger)! } }) : stranger.get(path(id));
      const hidden = await json<{ error: string }>(await send(group.id), 404);
      expect(hidden).toEqual(await json(await send(crypto.randomUUID()), 404));
      expect(JSON.stringify(hidden)).not.toContain(group.name);
    }
    await json(await post(stranger, "/api/groups", { name: "越权", companionIds: people.map(p => p.id) }), 404);
    expect(await read(owner, group.id)).toEqual(group);
  } finally { await owner.dispose(); await stranger.dispose(); }
});

test("mutations require a matching Origin and reject cross-site metadata", async ({ request }) => {
  const { group, people } = await setup(request);
  const rejectedHeaders: Record<string, string>[] = [{}, { origin: "https://foreign.example.invalid" }, { origin: origins.get(request)!, "sec-fetch-site": "cross-site" }];
  for (const headers of rejectedHeaders) {
    await json(await request.post("/api/groups", { headers, data: { name: "拒绝", companionIds: people.map(p => p.id) } }), 403);
    await json(await request.post(path(group.id), { headers, data: { action: "message", content: "拒绝", clientId: crypto.randomUUID() } }), 403);
    await json(await request.delete(path(group.id), { headers }), 403);
  }
  expect(await read(request, group.id)).toEqual(group);
  expect((await json<{ groups: GroupSummary[] }>(await request.get("/api/groups"))).groups).toHaveLength(1);
});

test("new UI turn persists and finishes replying before a gated old reply is released", async ({ page }) => {
  const { group } = await setup(page.request);
  const endpoint = `**/api/groups/${group.id}`;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let heldTurn: number | undefined;
  const replyTurns: number[] = [];
  await page.route(endpoint, async route => {
    const request = route.request();
    if (request.method() === "POST" && request.postDataJSON()?.action === "reply") {
      const action = request.postDataJSON() as Extract<GroupAction, { action: "reply" }>;
      replyTurns.push(action.turn);
      if (heldTurn === undefined) { heldTurn = action.turn; await gate; }
    }
    await route.continue();
  });
  try {
    await page.goto(`/groups/${group.id}`);
    const composer = page.getByLabel("群聊消息", { exact: true });
    const send = page.getByRole("button", { name: "发送", exact: true });
    const firstResponse = responseFor(page, group.id, "message");
    await composer.fill("大家先聊旧话题。");
    await send.click();
    const first = await (await firstResponse).json() as GroupResult;
    await expect.poll(() => heldTurn).toBe(first.group.turn);

    const content = "大家换个新话题，现在就打断旧轮。";
    await composer.fill(content);
    await send.click();
    // This must pass while the FIRST reply request is still held at the browser.
    // Optimistic text alone cannot prove the server fenced the old turn.
    await expect.poll(async () => {
      const persisted = await read(page.request, group.id);
      return { turn: persisted.turn, content: persisted.messages.filter(message => message.speakerId === null).at(-1)?.content };
    }).toEqual({ turn: first.group.turn + 1, content });
    // The new turn's replies must also complete before releasing the old HTTP
    // request. A message-only FIFO fix still blocks here if replies share a lane.
    await expect.poll(async () => (await read(page.request, group.id)).messages.length).toBe(4);
    const beforeRelease = await read(page.request, group.id);
    expect(beforeRelease.messages.slice(0, 2).every(message => message.speakerId === null)).toBe(true);
    expect(beforeRelease.messages.slice(2).every(message => message.speakerId !== null)).toBe(true);
    expect(beforeRelease.messages[1].clientId).toBeTruthy();

    const oldReply = page.waitForResponse(response => new URL(response.url()).pathname === path(group.id) &&
      response.request().method() === "POST" && response.request().postDataJSON()?.action === "reply" &&
      response.request().postDataJSON()?.turn === first.group.turn);
    release();
    expect((await oldReply).status()).toBe(409);
    const latest = await read(page.request, group.id);
    expect(latest).toEqual(beforeRelease);
    expect(latest.turn).toBe(first.group.turn + 1);
    expect(replyTurns.filter(turn => turn === first.group.turn)).toHaveLength(1);
    expect(replyTurns.filter(turn => turn === latest.turn)).toHaveLength(2);
    await expect(page.getByRole("checkbox", { name: "选作群记忆", exact: true })).toHaveCount(4);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  } finally {
    release();
    await page.unroute(endpoint);
  }
});

test("visible group flow creates two-member group, shows pending message, replies, reload, settings, memory and delete", async ({ page }) => {
  await login(page.request);
  const people = [await companion(page.request, "小林"), await companion(page.request, "小夏")];
  await page.goto("/groups");
  await page.getByRole("button", { name: "创建群聊", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "邀故人围坐" });
  await dialog.getByLabel("群名称", { exact: true }).fill("浏览器茶馆");
  await dialog.getByLabel("群背景", { exact: true }).fill("朋友相聚");
  for (const p of people) await dialog.getByRole("checkbox", { name: p.name, exact: true }).check();
  const created = page.waitForResponse(r => new URL(r.url()).pathname === "/api/groups" && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "创建群聊", exact: true }).click();
  const group = (await (await created).json() as GroupResult).group;
  await expect(page).toHaveURL(`/groups/${group.id}`);
  await expect(page.getByRole("heading", { name: "浏览器茶馆", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "＠ 选择成员", exact: true }).click();
  for (const p of people) await page.getByRole("checkbox", { name: `@${p.name}`, exact: true }).check();
  // Hold only the message request, proving the optimistic bubble exists before acknowledgement.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/groups/${group.id}`, async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "message") await gate;
    await route.continue();
  });
  const content = "今天一起去公园散步吧。";
  const replies: GroupResult[] = [];
  page.on("response", async response => {
    if (new URL(response.url()).pathname === path(group.id) && response.request().method() === "POST" && response.request().postDataJSON()?.action === "reply" && response.ok()) {
      replies.push(await response.json() as GroupResult);
    }
  });
  await page.getByLabel("群聊消息", { exact: true }).fill(content);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  try {
    await expect(page.getByRole("listitem").filter({ hasText: content })).toHaveCount(1);
    expect((await read(page.request, group.id)).messages).toEqual([]);
  } finally { release(); }
  await expect.poll(() => replies.length).toBe(2);
  expect(replies.map(r => r.source)).toEqual(["local", "local"]);
  expect(replies.map(r => r.group.messages.length)).toEqual([2, 3]);
  await expect(page.getByRole("checkbox", { name: "选作群记忆", exact: true })).toHaveCount(3);
  const persisted = await read(page.request, group.id);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "选作群记忆", exact: true })).toHaveCount(3);
  expect(await read(page.request, group.id)).toEqual(persisted);
  await page.getByRole("button", { name: "成员与设置", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "成员与群设置", exact: true });
  await panel.getByLabel("群名称", { exact: true }).fill("改名后的茶馆");
  await panel.getByLabel("自定义间隔（分钟）", { exact: true }).fill("30");
  await panel.getByLabel("群内关系", { exact: true }).first().fill("老朋友");
  const saved = responseFor(page, group.id, "update");
  await panel.getByRole("button", { name: "保存成员与设置", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "改名后的茶馆", exact: true })).toBeVisible();
  expect((await read(page.request, group.id)).settings.intervalMinutes).toBe(30);
  await page.getByRole("listitem").filter({ hasText: content }).getByRole("checkbox", { name: "选作群记忆", exact: true }).check();
  const memoryPanel = page.getByRole("complementary", { name: "群记忆", exact: true });
  await expect(memoryPanel.getByRole("blockquote")).toContainText(content);
  await memoryPanel.getByLabel("确认要记住的内容", { exact: true }).fill("约好公园散步");
  await memoryPanel.getByRole("checkbox", { name: people[0].name, exact: true }).check();
  const remembered = responseFor(page, group.id, "remember");
  await memoryPanel.getByRole("button", { name: "确认群记忆", exact: true }).click();
  expect((await remembered).status()).toBe(200);
  const memory = (await read(page.request, group.id)).memories[0];
  expect(memory).toMatchObject({ content: "约好公园散步", sourceMessageIds: [persisted.messages[0].id], knownBy: [people[0].id], confirmed: true });
  await page.reload();
  await page.getByRole("button", { name: "群记忆", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "群记忆", exact: true })).toContainText("约好公园散步");
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: "design/previews/2026-11-13/group-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "design/previews/2026-11-13/group-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "成员与设置", exact: true }).click();
  await panel.getByRole("button", { name: "删除群聊", exact: true }).click();
  expect((await read(page.request, group.id)).id).toBe(group.id);
  await panel.getByRole("button", { name: "确认删除群聊", exact: true }).click();
  await expect(page).toHaveURL("/groups");
  await json(await page.request.get(path(group.id)), 404);
});
