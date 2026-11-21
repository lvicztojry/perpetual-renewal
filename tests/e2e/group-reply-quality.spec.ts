import type { APIRequestContext, APIResponse } from "@playwright/test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "./fixtures";
import type { GroupResult, GroupState } from "../../src/lib/groups/types";
import type { CompanionProfile } from "../../src/lib/renewal/types";
import type { UsageDashboard } from "../../src/lib/usage/types";

// Parent owns the isolated app (E2E_BASE_URL=http://localhost:3012).
// Only this fake upstream is started by the tests; no app, DB or mail helpers.
const model = "fake-compatible/group-reply-quality";
const tail = "回家的路上记得看看晚霞。";
const firstReply = `我更喜欢下班后留一小段不用赶时间的空隙，让脑子里的事情慢慢沉下来。${tail}`;
const discarded = `${tail}嗯，是的，确实如此。`;
const repeatedRepair = `我也觉得，${tail}好的呀。`;
const uniqueReply = "我倒想聊聊音乐，同一首曲子换个编曲，听起来就像换了一种心情。";
const userText = "大家说说今天的想法。";
type ProviderMessage = { role: string; content: string };
type ProviderCall = { model?: string; messages: ProviderMessage[]; authenticated: boolean };
type Provider = Awaited<ReturnType<typeof startFakeProvider>>;
type Scenario = Awaited<ReturnType<typeof setup>>;

test.beforeEach(async ({ baseURL }) => {
  expect(baseURL, "Use the parent's isolated loopback app").toBeTruthy();
  const url = new URL(baseURL!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(url.hostname);
  expect(["http:", "https:"]).toContain(url.protocol);
  expect(Boolean(url.username || url.password)).toBe(false);
  expect(process.env.E2E_REAL_PROVIDER).not.toBe("1");
  expect(process.env.E2E_REPOSITORY ?? "memory").toBe("memory");
  expect(process.env.E2E_AUTH_MODE ?? "local-email").toBe("local-email");
});

test("copied peer tail is repaired once before a group reply is shown or persisted", async ({ page, baseURL }) => {
  const provider = await startFakeProvider([firstReply, discarded, uniqueReply]);
  try {
    const scenario = await setup(page.request, baseURL!, provider);
    await watchDiscarded(page);
    const replies = await sendFromUi(page, scenario, 200);
    expect(replies.first.group.messages.at(-1)).toMatchObject({ speakerId: scenario.people[0].id, content: firstReply });
    expect(replies.second!.source).toBe("model");
    await assertAccepted(page, scenario, provider, 3);
    assertOriginalCalls(provider, scenario);
    assertCorrection(provider.calls[2], provider.calls[1], scenario.people[1].name);
    await assertUsage(page.request, scenario, ["success"], ["error", "success"]);
    // A successful delivery is idempotent, including after a repaired completion.
    const replay = await postReply(page.request, scenario, replies.second!.group.turn);
    expect(replay.group.messages).toEqual(replies.second!.group.messages);
    expect(provider.calls).toHaveLength(3);
    await page.reload();
    await expect(page.getByLabel("群聊天记录").getByText(uniqueReply, { exact: true })).toBeVisible();
    await assertNoDiscarded(page);
  } finally { await provider.close(); }
});

test("a second repeated candidate fails without persistence; an explicit retry commits only one reply", async ({ page, baseURL }) => {
  const provider = await startFakeProvider([firstReply, discarded, repeatedRepair, uniqueReply]);
  try {
    const scenario = await setup(page.request, baseURL!, provider);
    await watchDiscarded(page);
    const replies = await sendFromUi(page, scenario, 502);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("回复未完成");
    await expect(page.getByText("本次回复生成失败，未自动重试。可以发送新消息开始下一轮。", { exact: true })).toBeVisible();
    const failed = await readGroup(page.request, scenario.group.id);
    expect(failed.messages.map(message => message.content)).toEqual([userText, firstReply]);
    await expect(page.getByRole("checkbox", { name: "选作群记忆", exact: true })).toHaveCount(2);
    expect(provider.calls).toHaveLength(3); // First member + at most two second-member candidates.
    assertOriginalCalls(provider, scenario);
    assertCorrection(provider.calls[2], provider.calls[1], scenario.people[1].name);
    await assertNoDiscarded(page);
    await assertUsage(page.request, scenario, ["success"], ["error", "error"]);
    expect(provider.calls).toHaveLength(3); // Reading state and usage cannot auto-retry generation.

    // Explicit HTTP retry of the failed claim, without resending the user turn.
    // The UI intentionally offers a new turn after a 502, not an automatic retry.
    const retried = await postReply(page.request, scenario, replies.first.group.turn);
    expect(retried.source).toBe("model");
    expect(retried.group.turn).toBe(replies.first.group.turn);
    expect(lastData(provider.calls[3]).self.id).toBe(scenario.people[1].id);
    // The server clock is refreshed for an explicit retry; history and persona
    // remain canonical, with neither discarded candidate added as a real turn.
    expect(provider.calls[3].messages.slice(1, -1)).toEqual(provider.calls[1].messages.slice(1, -1));
    expect(lastData(provider.calls[3]).self).toEqual(lastData(provider.calls[1]).self);
    expect(lastData(provider.calls[3]).task).toBe(lastData(provider.calls[1]).task);
    expect(JSON.stringify(provider.calls[3].messages)).not.toContain(scenario.markers[0]);
    await page.reload();
    await assertAccepted(page, scenario, provider, 4);
    await assertUsage(page.request, scenario, ["success"], ["error", "error", "success"]);
    const replay = await postReply(page.request, scenario, retried.group.turn);
    expect(replay.group.messages).toEqual(retried.group.messages);
    expect(provider.calls).toHaveLength(4);
  } finally { await provider.close(); }
});

async function json<T>(response: Pick<APIResponse, "status" | "url" | "json">, status = 200): Promise<T> {
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}

async function setup(api: APIRequestContext, baseURL: string, provider: Provider) {
  const origin = new URL(baseURL).origin;
  const headers = { origin };
  const login = await json<{ session: { provider: string; userId: string } }>(await api.post("/api/auth/login", {
    headers, data: { email: `group-quality-${crypto.randomUUID()}@example.invalid`, nickname: "群回复隔离验收" }
  }));
  expect(login.session.provider).toBe("local-email");
  expect(login.session.userId).toMatch(/^memory-user-/);
  const readiness = await json<{ configStatus: { items: Array<{ id: string; status: string }> } }>(
    await api.get("/api/me/config-status"));
  for (const id of ["llm_key", "database"]) {
    expect(readiness.configStatus.items.find(item => item.id === id)?.status, `${id} must be absent before dummy save`).toBe("missing");
  }
  const credential = await json<{ credential: { configured: boolean } }>(await api.get("/api/me/llm-credential"));
  expect(credential.credential.configured).toBe(false);
  const before = await json<{ dashboard: UsageDashboard }>(await api.get("/api/usage/model-calls"));
  expect(before.dashboard.persistence).toBe("memory");
  expect(before.dashboard.summary.calls).toBe(0);
  const saved = await json<{ credential: { configured: boolean; provider: string; model: string } }>(
    await api.put("/api/me/llm-credential", { headers, data: {
      provider: "compatible", apiKey: provider.dummyKey, baseUrl: provider.baseUrl, model
    } }));
  expect(saved.credential).toMatchObject({ configured: true, provider: "compatible", model });
  expect(provider.calls).toHaveLength(0);
  const markers = ["SELF_ONLY_AMBER_QUALITY", "SELF_ONLY_INDIGO_QUALITY"];
  const people: CompanionProfile[] = [];
  for (const [index, name] of ["岚舟", "听澜"].entries()) {
    const result = await json<{ companion: CompanionProfile }>(await api.post("/api/companions", { headers, data: {
      name, relationshipKind: "FRIEND", personality: index === 0 ? ["健谈"] : ["寡言"],
      speakingStyle: `${markers[index]}_STYLE，按自己的节奏接话。`, background: `${markers[index]}_BACKGROUND`,
      boundaries: `${markers[index]}_BOUNDARY`, proactiveMessagesEnabled: false, immersionEnabled: true
    } }), 201);
    people.push(result.companion);
  }
  const { group } = await json<GroupResult>(await api.post("/api/groups", { headers, data: {
    name: "群回复质量验收", background: "两位合成朋友的文字群聊。", companionIds: people.map(person => person.id)
  } }));
  expect(group.settings).toMatchObject({ proactiveEnabled: false, autoChat: false, maxReplies: 2 });
  expect(group.members.every(member => !member.allowPrivateMemories)).toBe(true);
  return { group, people, markers, origin };
}

async function readGroup(api: APIRequestContext, id: string): Promise<GroupState> {
  return (await json<GroupResult>(await api.get(`/api/groups/${id}`))).group;
}

async function postReply(api: APIRequestContext, scenario: Scenario, turn: number) {
  return json<GroupResult>(await api.post(`/api/groups/${scenario.group.id}`, {
    headers: { origin: scenario.origin }, data: { action: "reply", turn, speakerId: scenario.people[1].id }
  }));
}

async function sendFromUi(page: Page, scenario: Scenario, secondStatus: number) {
  await page.goto(`/groups/${scenario.group.id}`);
  await expect(page.getByRole("heading", { name: scenario.group.name, exact: true })).toBeVisible();
  const endpoint = `/api/groups/${scenario.group.id}`;
  const sent = page.waitForResponse(response => new URL(response.url()).pathname === endpoint &&
    response.request().method() === "POST" && response.request().postDataJSON()?.action === "message");
  const replyResponse = (speakerId: string) => page.waitForResponse(response =>
    new URL(response.url()).pathname === endpoint && response.request().method() === "POST" &&
    response.request().postDataJSON()?.action === "reply" && response.request().postDataJSON()?.speakerId === speakerId);
  const first = replyResponse(scenario.people[0].id);
  const second = replyResponse(scenario.people[1].id);
  await page.getByLabel("群聊消息", { exact: true }).fill(userText);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const plan = await json<GroupResult>(await sent);
  expect(plan.speakers).toEqual(scenario.people.map(person => person.id));
  const firstResult = await json<GroupResult>(await first);
  const secondResponse = await second;
  expect(secondResponse.status()).toBe(secondStatus);
  // Failed replies are checked through status, visible UI and canonical GET;
  // no error response body is needed to prove that a candidate was discarded.
  const secondResult = secondStatus === 200 ? await json<GroupResult>(secondResponse) : null;
  return { first: firstResult, second: secondResult };
}

function lastData(call: ProviderCall) {
  return JSON.parse(call.messages.at(-1)!.content);
}

function assertOriginalCalls(provider: Provider, scenario: Scenario) {
  for (const [index, call] of provider.calls.slice(0, 2).entries()) {
    expect(call.authenticated, "Fake upstream received the dummy credential").toBe(true);
    expect(call.model).toBe(model);
    const data = lastData(call);
    expect(data.self.id).toBe(scenario.people[index].id);
    expect(data.self.speakingStyle).toContain(scenario.markers[index]);
    expect(data.knownPeople.map((person: { id: string }) => person.id)).toEqual(scenario.people.map(person => person.id));
    expect(data.privateMemories).toEqual([]);
    expect(JSON.stringify(call.messages)).not.toContain(scenario.markers[1 - index]);
  }
  expect(provider.calls[1].messages.some(message => message.role === "user" && message.content.includes(firstReply))).toBe(true);
}

function assertCorrection(repair: ProviderCall, original: ProviderCall, name: string) {
  expect(repair.authenticated).toBe(true);
  expect(repair.model).toBe(model);
  expect(repair.messages.slice(0, -2)).toEqual(original.messages);
  expect(repair.messages.at(-2)).toEqual({ role: "assistant", content: discarded });
  const correction = lastData(repair);
  expect(correction).toMatchObject({ issue: "copied-fragment", self: name });
  expect(correction.task).toContain("尚未发送的重复候选");
  expect(correction.task).toContain("不摘抄群友末句");
  expect(correction).not.toHaveProperty("conversation");
}

async function assertUsage(api: APIRequestContext, scenario: Scenario, firstStatuses: string[], secondStatuses: string[]) {
  const { dashboard } = await json<{ dashboard: UsageDashboard }>(await api.get("/api/usage/model-calls"));
  expect(dashboard.persistence).toBe("memory");
  expect(dashboard.summary.calls).toBe(firstStatuses.length + secondStatuses.length);
  for (const [index, statuses] of [firstStatuses, secondStatuses].entries()) {
    const logs = dashboard.recent.filter(log => log.companionId === scenario.people[index].id);
    expect(logs.map(log => log.status).sort()).toEqual([...statuses].sort());
    for (const log of logs) {
      expect(log).toMatchObject({ purpose: "group_reply", provider: "compatible", model });
      expect(log.errorKind).toBe(log.status === "error" ? "repetition" : null);
    }
  }
}

async function assertAccepted(page: Page, scenario: Scenario, provider: Provider, count: number) {
  const log = page.getByLabel("群聊天记录");
  await expect(log.getByText(firstReply, { exact: true })).toBeVisible();
  await expect(log.getByText(uniqueReply, { exact: true })).toBeVisible();
  await expect(log.getByRole("checkbox", { name: "选作群记忆", exact: true })).toHaveCount(3);
  const group = await readGroup(page.request, scenario.group.id);
  expect(group.messages.map(message => [message.speakerId, message.content])).toEqual([
    [null, userText], [scenario.people[0].id, firstReply], [scenario.people[1].id, uniqueReply]
  ]);
  expect(new Set(group.messages.map(message => message.id)).size).toBe(3);
  expect(provider.calls).toHaveLength(count);
  expect(provider.unexpectedRoutes).toBe(0);
  await assertNoDiscarded(page);
}

async function watchDiscarded(page: Page) {
  await page.addInitScript(({ candidates }) => {
    const state = window as Window & { __discardedGroupCandidateSeen?: boolean };
    state.__discardedGroupCandidateSeen = false;
    new MutationObserver(records => {
      const log = document.querySelector('[aria-label="群聊天记录"]');
      if (!log) return;
      const inspect = (text: string | null) => {
        if (candidates.some(candidate => text?.includes(candidate))) state.__discardedGroupCandidateSeen = true;
      };
      inspect(log.textContent);
      for (const record of records) {
        if (!log.contains(record.target)) continue;
        for (const node of record.addedNodes) inspect(node.textContent);
        if (record.type === "characterData") inspect(record.target.textContent);
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }, { candidates: [discarded, repeatedRepair] });
}

async function assertNoDiscarded(page: Page) {
  for (const candidate of [discarded, repeatedRepair]) {
    await expect(page.getByLabel("群聊天记录").getByText(candidate, { exact: true })).toHaveCount(0);
  }
  expect(await page.evaluate(() => (window as Window & { __discardedGroupCandidateSeen?: boolean }).__discardedGroupCandidateSeen)).toBe(false);
}

async function startFakeProvider(replies: string[]) {
  const calls: ProviderCall[] = [];
  const dummyKey = `e2e-dummy-group-quality-${crypto.randomUUID()}`;
  let unexpectedRoutes = 0;
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method === "GET" && path === "/v1/models") {
        writeJson(response, 200, { object: "list", data: [{ id: model, object: "model", owned_by: "e2e" }] });
        return;
      }
      if (request.method !== "POST" || path !== "/v1/chat/completions") {
        unexpectedRoutes++;
        writeJson(response, 404, { error: "Unexpected fake route" });
        return;
      }
      const body = JSON.parse(await readBody(request)) as { model?: string; messages: ProviderMessage[] };
      // Store only a boolean; never retain or print Authorization/header diagnostics.
      calls.push({ model: body.model, messages: body.messages, authenticated: request.headers.authorization === `Bearer ${dummyKey}` });
      const content = replies[calls.length - 1];
      if (content === undefined) {
        writeJson(response, 400, { error: "Fake script exhausted" });
        return;
      }
      writeJson(response, 200, {
        id: `chatcmpl-group-quality-${calls.length}`, object: "chat.completion", model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 16, total_tokens: 36 }
      });
    } catch { writeJson(response, 400, { error: "Invalid fake request" }); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    calls, dummyKey, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    get unexpectedRoutes() { return unexpectedRoutes; },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    })
  };
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}
