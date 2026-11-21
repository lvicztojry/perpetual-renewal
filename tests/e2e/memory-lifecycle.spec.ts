import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect, test } from "./fixtures";
import type { MemoryRecord, CompanionProfile } from "../../src/lib/renewal/types";
import type { MemoryRevisionRecord } from "../../src/lib/memory/lifecycle";

test.use({ showIntro: false });
const origins = new WeakMap<APIRequestContext, string>();
async function body<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status()).toBe(status);
  expect(response.headers()["cache-control"]).toContain("no-store");
  return response.json() as Promise<T>;
}
function post(api: APIRequestContext, url: string, data: unknown) { return api.post(url, { data, headers: { origin: origins.get(api)! } }); }
async function setup(api: APIRequestContext) {
  const login = await api.post("/api/auth/login", { data: { email: `memory-${crypto.randomUUID()}@example.invalid`, nickname: "隔离记忆验收" } });
  await body(login); origins.set(api, new URL(login.url()).origin);
  const companion = (await body<{ companion: CompanionProfile }>(await post(api, "/api/companions", { name: "临时小林", relationshipKind: "FRIEND", speakingStyle: "自然", proactiveMessagesEnabled: false }), 201)).companion;
  const make = async (content: string) => (await body<{ memories: MemoryRecord[] }>(await post(api, `/api/companions/${companion.id}/memories`, { type: "user_fact", content }), 201)).memories[0];
  let old = await make("正在准备面试");
  old = (await body<{ memory: MemoryRecord }>(await api.patch(`/api/memories/${old.id}`, { data: { status: "active", expectedUpdatedAt: old.updatedAt } }))).memory;
  const next = await make("已经入职了");
  return { companion, old, next };
}
const path = (id: string) => `/api/memories/${id}/history`;
const replacement = (old: MemoryRecord, next: MemoryRecord) => ({ action: "supersede", expectedUpdatedAt: old.updatedAt, replacementId: next.id, replacementUpdatedAt: next.updatedAt });

test("replacement is atomic, keeps history, rejects stale restore and forget purges history/export", async ({ request }) => {
  const { companion, old, next } = await setup(request);
  const result = await body<{ memories: MemoryRecord[] }>(await post(request, path(old.id), replacement(old, next)));
  expect(result.memories.find(item => item.id === old.id)).toMatchObject({ status: "archived", content: old.content, supersededById: next.id });
  expect(result.memories.find(item => item.id === next.id)).toMatchObject({ status: "active", supersededById: null });
  const history = await body<{ items: MemoryRevisionRecord[] }>(await request.get(path(old.id)));
  expect(history.items.at(0)).toMatchObject({ kind: "superseded", before: { content: old.content, status: "active" }, after: { status: "archived" } });
  await body(await request.patch(`/api/memories/${old.id}`, { data: { status: "active", expectedUpdatedAt: result.memories.find(item => item.id === old.id)!.updatedAt } }), 409);
  await body(await request.patch(`/api/memories/${next.id}`, { data: { status: "active" } }), 400);
  await body(await request.patch(`/api/memories/${next.id}`, { data: { content: "missing-version" } }), 400);
  await body(await request.patch(`/api/memories/${next.id}`, { data: { content: "stale", expectedUpdatedAt: next.updatedAt } }), 409);
  await body(await request.delete(`/api/memories/${old.id}`, { data: "{", headers: { "content-type": "application/json" } }), 400);
  await body(await request.delete(`/api/memories/${old.id}`, { data: [] }), 400);
  expect((await body<{ items: unknown[] }>(await request.get(path(old.id)))).items.length).toBeGreaterThan(0);
  await body(await request.delete(`/api/memories/${old.id}`));
  expect((await body<{ items: unknown[] }>(await request.get(path(old.id)))).items).toEqual([]);
  const exported = await body<{ memoryRevisions: MemoryRevisionRecord[] }>(await request.get("/api/me/export"));
  expect(exported.memoryRevisions.some(item => item.memoryId === old.id)).toBe(false);
  expect(JSON.stringify(exported.memoryRevisions)).not.toContain(old.content);
  const list = await body<{ memories: MemoryRecord[] }>(await request.get(`/api/companions/${companion.id}/memories`));
  expect(list.memories.some(item => item.id === old.id)).toBe(false);
});

test("history routes enforce session, owner, same origin and streamed size cap", async ({ request, playwright, baseURL }) => {
  await body(await request.get(path("missing")), 401);
  const { old, next } = await setup(request);
  await body(await request.post(path(old.id), { data: replacement(old, next), headers: { origin: "https://foreign.invalid" } }), 403);
  await body(await post(request, path(old.id), { ...replacement(old, next), padding: "x".repeat(17000) }), 400);
  const other = await playwright.request.newContext({ baseURL });
  try {
    await setup(other);
    await body(await other.get(path(old.id)), 404);
    await body(await post(other, path(old.id), replacement(old, next)), 404);
  } finally { await other.dispose(); }
});

test("candidate confirmation cannot activate an unseen edit from another device", async ({ request }) => {
  const { next } = await setup(request);
  const changed = (await body<{ memory: MemoryRecord }>(await request.patch(`/api/memories/${next.id}`, { data: { content: "另一端核对后的事实", expectedUpdatedAt: next.updatedAt } }))).memory;
  await body(await request.patch(`/api/memories/${next.id}`, { data: { status: "active" } }), 400);
  await body(await request.patch(`/api/memories/${next.id}`, { data: { status: "active", expectedUpdatedAt: next.updatedAt } }), 409);
  const confirmed = (await body<{ memory: MemoryRecord }>(await request.patch(`/api/memories/${next.id}`, { data: { status: "active", expectedUpdatedAt: changed.updatedAt } }))).memory;
  expect(confirmed).toMatchObject({ status: "active", content: changed.content });
});

test("mobile memory management previews replacement, shows history and confirms irreversible deletion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { companion, old, next } = await setup(page.request);
  await page.goto(`/?companion=${companion.id}`);
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  const deleteButton = page.getByRole("button", { name: `删除记忆：${old.content}`, exact: true });
  const row = page.locator(".memory-item").filter({ has: deleteButton });
  await row.locator("summary").filter({ hasText: "用另一条记忆更新这个事实" }).click();
  await row.getByLabel("替代记忆", { exact: true }).selectOption(next.id);
  const before = await body<{ items: MemoryRevisionRecord[] }>(await page.request.get(path(old.id)));
  expect(before.items.some(item => item.kind === "superseded")).toBe(false);
  await expect(row.getByText(`将归档：${old.content}`)).toBeVisible();
  await row.getByRole("button", { name: "确认新事实生效", exact: true }).click();
  await expect(row).toContainText("已由后续事实替代");
  await row.locator("summary").filter({ hasText: "记忆变更历史" }).click();
  await expect(row).toContainText("旧事实归档");
  await expect(row.getByRole("button", { name: "恢复", exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  page.once("dialog", async dialog => { expect(dialog.message()).toContain("原始聊天消息仍会保留"); await dialog.accept(); });
  await page.getByRole("button", { name: `删除记忆：${old.content}`, exact: true }).click();
  await expect(deleteButton).toHaveCount(0);
  expect((await body<{ items: unknown[] }>(await page.request.get(path(old.id)))).items).toEqual([]);
});
