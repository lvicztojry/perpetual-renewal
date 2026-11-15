import type { APIRequestContext, APIResponse } from "@playwright/test";
import process from "node:process";
import { expect, test, type Page } from "./fixtures";
import type { CompanionProfile } from "../../src/lib/renewal/types";
import type { DreamAction, DreamGetResponse, DreamPostResponse } from "../../src/lib/dream/types";

// Run against the controller's isolated local-email / memory server, with LLM keys
// cleared (the normal E2E release-gate configuration). No provider or mail server
// is started here. Local dream samples verify workflow, never model quality.
test.use({ showIntro: false });
const origins = new WeakMap<APIRequestContext, string>();

test.beforeEach(async ({ baseURL, request }) => {
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL!).hostname);
  origins.set(request, new URL(baseURL!).origin);
  expect(process.env.E2E_REAL_PROVIDER).not.toBe("1");
  expect(process.env.E2E_REPOSITORY ?? "memory").toBe("memory");
  expect(process.env.E2E_AUTH_MODE ?? "local-email").toBe("local-email");
});

async function json<T>(response: APIResponse, status = 200): Promise<T> {
  // Avoid attaching arbitrary response bodies (which may contain secrets) to failures.
  expect(response.status(), new URL(response.url()).pathname).toBe(status);
  return response.json() as Promise<T>;
}

async function createOwnCompanion(api: APIRequestContext) {
  const stamp = crypto.randomUUID();
  const loginResponse = await api.post("/api/auth/login", {
    data: { email: `dream-${stamp}@perpetual-renewal.local`, nickname: "入梦验收" }
  });
  origins.set(api, new URL(loginResponse.url()).origin);
  const login = await json<{ session: { provider: string; userId: string } }>(loginResponse);
  expect(login.session.provider).toBe("local-email");
  expect(login.session.userId).toMatch(/^memory-user-/);
  const readiness = await json<{ configStatus: { items: Array<{ id: string; status: string }> } }>(
    await api.get("/api/me/config-status")
  );
  expect(readiness.configStatus.items.find(item => item.id === "llm_key")?.status,
    "The controller's server must have LLM keys cleared before any dream generation").toBe("missing");
  const result = await json<{ companion: CompanionProfile }>(await api.post("/api/companions", {
    data: {
      name: "小林", relationshipKind: "CUSTOM", customKind: "入梦隔离验收",
      speakingStyle: "自然简短，不用昵称。", personality: ["平实"],
      proactiveMessagesEnabled: false, immersionEnabled: true
    }
  }), 201);
  return result.companion;
}

async function officialSnapshot(api: APIRequestContext, companion: CompanionProfile) {
  const profile = await json<{ companion: CompanionProfile }>(await api.get(`/api/companions/${companion.id}`));
  const messages = await json<{ messages: unknown[] }>(await api.get(`/api/conversations/${companion.conversationId}/messages`));
  const memories = await json<{ memories: unknown[] }>(await api.get(`/api/companions/${companion.id}/memories`));
  return { companion: profile.companion, messages: messages.messages, memories: memories.memories };
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
}

const dreamPath = (id: string) => `/api/companions/${id}/dream`;
function postDream(api: APIRequestContext, path: string, data: unknown) {
  const origin = origins.get(api);
  if (!origin) throw new Error("Dream request context has no local origin");
  return api.post(path, { data, headers: { origin } });
}
async function act(api: APIRequestContext, id: string, action: DreamAction) {
  return json<DreamPostResponse>(await postDream(api, dreamPath(id), action));
}
async function readDream(api: APIRequestContext, id: string) {
  return json<DreamGetResponse>(await api.get(dreamPath(id)));
}

test("local mock dream: correction, confirmed edit, apply, resume and restore preserve official history", async ({ request }) => {
  const own = await createOwnCompanion(request);
  // A real nonempty memory catches deletion/rewriting as well as accidental additions.
  const seeded = await json<{ memories: unknown[] }>(await request.post(`/api/companions/${own.id}/memories`, {
    data: { type: "user_fact", content: "验收用户喜欢雨后的散步，这条正式记忆不可被入梦改写。" }
  }), 201);
  expect(seeded.memories).toHaveLength(1);
  const before = await officialSnapshot(request, own);
  expect((await readDream(request, own.id)).state).toBeNull();
  let state = (await act(request, own.id, { action: "start" })).state;
  const generated = await act(request, own.id, {
    action: "generate", revision: state.revision, mode: "compare", message: "我今天有点累，想安静待一会儿。"
  });
  expect(generated.source, "This gate must use local mock samples, never a real provider").toBe("local");
  state = generated.state;
  const round = state.rounds.at(-1)!;
  expect(round.source).toBe("local");
  expect(round.mode).toBe("compare");
  expect(round.choices).toHaveLength(3);
  expect(new Set(round.choices.map(choice => choice.id)).size).toBe(round.choices.length);
  for (const choice of round.choices) expect(choice.content.trim().length).toBeGreaterThan(0);
  const correction = "不要急着建议，先用一句简短的话接住我的疲惫。";
  state = (await act(request, own.id, {
    action: "feedback", revision: state.revision, roundId: round.id, correction, scope: "context"
  })).state;
  const corrected = state.fragments.find(fragment => fragment.text.includes(correction));
  expect(corrected).toBeDefined();
  expect(corrected?.origin).toBe("user");
  expect(corrected?.confirmed).toBe(false);
  expect(state.previewProfile.speakingStyle).not.toContain(correction);
  expect(state.rounds.find(item => item.id === round.id)?.feedback).toMatchObject({ correction, scope: "context" });
  const confirmedText = "当我说累时，先简短回应，再问我是否想安静陪伴。";
  const edited = await act(request, own.id, {
    action: "edit", revision: state.revision,
    draftProfile: { ...state.draftProfile, speakingStyle: "简短平实，先回应感受，再询问需要。" },
    fragments: state.fragments.map(fragment => ({ ...fragment, text: confirmedText, confirmed: true, scope: "context" }))
  });
  state = edited.state;
  expect(state.fragments).toEqual(expect.arrayContaining([expect.objectContaining({ text: confirmedText, confirmed: true, scope: "context" })]));
  expect(state.previewProfile.speakingStyle).toContain(confirmedText);
  // Separate GETs verify server persistence, rather than trusting POST echoes.
  expect((await readDream(request, own.id)).state).toEqual(state);
  expect(await officialSnapshot(request, own)).toEqual(before);
  const draft = state;
  state = (await act(request, own.id, { action: "apply", revision: state.revision })).state;
  expect(state.status).toBe("applied");
  expect(state.versions.some(version => version.kind === "apply")).toBe(true);
  const initialVersion = state.versions.find(version => version.kind === "initial");
  expect(initialVersion).toBeDefined();
  const applied = await officialSnapshot(request, own);
  expect(applied.companion.speakingStyle).toBe(draft.previewProfile.speakingStyle);
  expect(applied.companion.speakingStyle).not.toBe(before.companion.speakingStyle);
  expect(applied.companion.personality).toEqual(draft.previewProfile.personality);
  expect(applied.messages).toEqual(before.messages);
  expect(applied.memories).toEqual(before.memories);
  expect((await readDream(request, own.id)).state).toEqual(state);
  state = (await act(request, own.id, { action: "restore", revision: state.revision, versionId: initialVersion!.id })).state;
  expect(state.versions.some(version => version.kind === "restore")).toBe(true);
  const restored = await officialSnapshot(request, own);
  expect(restored.companion.speakingStyle).toBe(before.companion.speakingStyle);
  expect(restored.companion.personality).toEqual(before.companion.personality);
  expect(restored.messages).toEqual(before.messages);
  expect(restored.memories).toEqual(before.memories);
  expect((await readDream(request, own.id)).state).toEqual(state);
});

test("local mock choice feedback survives reload and free chat stays inside the dream", async ({ request }) => {
  const own = await createOwnCompanion(request);
  const before = await officialSnapshot(request, own);
  let state = (await act(request, own.id, { action: "start" })).state;
  const comparison = await act(request, own.id, { action: "generate", revision: state.revision, mode: "compare", message: "今天想分享一件开心的事。" });
  expect(comparison.source).toBe("local");
  state = comparison.state;
  const round = state.rounds.at(-1)!;
  const chosen = round.choices[1];
  expect(chosen).toBeDefined();
  state = (await act(request, own.id, { action: "feedback", revision: state.revision, roundId: round.id, choiceId: chosen.id, scope: "occasional" })).state;
  expect((await readDream(request, own.id)).state?.rounds.find(item => item.id === round.id)?.feedback).toMatchObject({ choiceId: chosen.id, scope: "occasional" });
  const free = await act(request, own.id, { action: "generate", revision: state.revision, mode: "free", message: "我们慢慢聊一会儿。" });
  expect(free.source).toBe("local");
  expect(free.state.rounds.at(-1)).toMatchObject({ mode: "free", source: "local" });
  expect(free.state.rounds.at(-1)?.choices).toHaveLength(1);
  expect((await readDream(request, own.id)).state).toEqual(free.state);
  expect(await officialSnapshot(request, own)).toEqual(before);
});

test("stale dream revisions return 409 and preserve the newest draft and official data", async ({ request }) => {
  const own = await createOwnCompanion(request);
  const original = (await act(request, own.id, { action: "start" })).state;
  const newest = (await act(request, own.id, {
    action: "edit", revision: original.revision,
    draftProfile: { ...original.draftProfile, speakingStyle: "保留这份最新草稿。" }, fragments: []
  })).state;
  expect(newest.revision).toBeGreaterThan(original.revision);
  const before = await officialSnapshot(request, own);
  for (const action of [
    { action: "edit", revision: original.revision, draftProfile: original.draftProfile, fragments: [] },
    { action: "apply", revision: original.revision }
  ] satisfies DreamAction[]) {
    await json<{ error: string }>(await postDream(request, dreamPath(own.id), action), 409);
    expect((await readDream(request, own.id)).state).toEqual(newest);
    expect(await officialSnapshot(request, own)).toEqual(before);
  }
});

test("invalid dream requests fail without echoing sensitive input or changing the draft", async ({ request }) => {
  const own = await createOwnCompanion(request);
  const state = (await act(request, own.id, { action: "start" })).state;
  const secret = ["sk", "dream-e2e-synthetic-secret-123456"].join("-");
  const endpoint = "https://private-dream.example.invalid/v1";
  const response = await postDream(request, dreamPath(own.id), {
    action: `invalid Authorization: Bearer ${secret} ${endpoint} rawPayload prompt at provider.ts:123`, revision: state.revision
  });
  const body = await json<{ error: string }>(response, 400);
  expect(body.error.trim().length).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toMatch(/sk-dream-e2e|private-dream|Authorization|rawPayload|provider\.ts|stack|prompt/i);
  expect((await readDream(request, own.id)).state).toEqual(state);
});

function dreamResponse(page: Page, id: string, action: DreamAction["action"]) {
  return page.waitForResponse(response => new URL(response.url()).pathname === dreamPath(id) &&
    response.request().method() === "POST" && response.request().postDataJSON()?.action === action);
}

test("mobile user continues dream rounds without replaying entry, auto-saves edits and explicitly finishes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const own = await createOwnCompanion(page.request);
  const before = await officialSnapshot(page.request, own);
  await page.goto(`/?companion=${encodeURIComponent(own.id)}`);
  const entry = page.getByRole("link", { name: "入梦", exact: true });
  await expect(entry).toHaveAttribute("href", `/dream/${own.id}`);
  await entry.click();
  await expect(page).toHaveURL(`/dream/${own.id}`);
  const started = dreamResponse(page, own.id, "start");
  await page.getByRole("button", { name: "进入梦境", exact: true }).click();
  await page.getByRole("button", { name: "跳过开场动画", exact: true }).click();
  expect((await started).status()).toBe(200);
  await page.getByRole("button", { name: "对比选择", exact: true }).click();
  const situation = page.getByLabel("梦中情境", { exact: true });
  await situation.scrollIntoViewIfNeeded();
  await expect(situation).toBeInViewport();
  await situation.fill("工作之后有些累，我只想慢慢说几句。");
  await expectNoHorizontalOverflow(page);
  const generated = dreamResponse(page, own.id, "generate");
  await page.getByRole("button", { name: "听听回响", exact: true }).click();
  const generatedResponse = await generated;
  expect(generatedResponse.status()).toBe(200);
  expect(((await generatedResponse.json()) as DreamPostResponse).source).toBe("local");
  const firstRound = page.getByRole("article", { name: "梦中片段 1", exact: true });
  await expect(firstRound).toContainText("本地演示");
  const choice = firstRound.getByRole("button", { name: "选择回声 1", exact: true });
  await expect(firstRound.getByRole("button", { name: /^选择回声 [123]$/ })).toHaveCount(3);
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await firstRound.getByRole("button", { name: "都不像", exact: true }).click();
  await expect(choice).toHaveAttribute("aria-pressed", "false");
  const correction = page.getByLabel("纠正这句回响", { exact: true });
  await correction.scrollIntoViewIfNeeded();
  await expect(correction).toBeInViewport();
  await correction.fill("不要追问原因，先平实地说我在这里陪你。");
  await page.getByLabel("适用范围", { exact: true }).selectOption("context");
  await expectNoHorizontalOverflow(page);
  const feedback = dreamResponse(page, own.id, "feedback");
  await page.getByRole("button", { name: "记录反馈", exact: true }).click();
  expect((await feedback).status()).toBe(200);
  await expect(situation).toBeFocused();
  await expect(page.getByRole("dialog", { name: "入梦开场", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "继续入梦", exact: true })).toHaveCount(0);
  const fragmentText = "听到我说累时，先平实地回应，再问是否需要安静陪伴。";
  await page.getByLabel("片段内容 1", { exact: true }).fill(fragmentText);
  await page.getByRole("checkbox", { name: "确认片段 1", exact: true }).check();
  const style = "说话简短平实，不使用夸张昵称。";
  await page.getByLabel("基础说话方式", { exact: true }).fill(style);
  const saved = dreamResponse(page, own.id, "edit");
  const secondGenerated = dreamResponse(page, own.id, "generate");
  await situation.fill("如果我今天很开心，你会怎样回应？");
  await page.getByRole("button", { name: "听听回响", exact: true }).click();
  expect((await saved).status()).toBe(200);
  expect((await secondGenerated).status()).toBe(200);
  const secondRound = page.getByRole("article", { name: "梦中片段 2", exact: true });
  await secondRound.getByRole("button", { name: "选择回声 2", exact: true }).click();
  // Feedback also saves edited fragments before sending its revision, without waking.
  await page.getByLabel("片段内容 1", { exact: true }).fill(`${fragmentText}不要反复追问。`);
  const feedbackSaved = dreamResponse(page, own.id, "edit");
  const secondFeedback = dreamResponse(page, own.id, "feedback");
  await page.getByRole("button", { name: "记录反馈", exact: true }).click();
  expect((await feedbackSaved).status()).toBe(200);
  expect((await secondFeedback).status()).toBe(200);
  await expect(situation).toBeFocused();
  await expect(page.getByRole("dialog", { name: "入梦开场", exact: true })).toBeHidden();
  const continued = (await readDream(page.request, own.id)).state!;
  expect(continued.status).toBe("draft");
  expect(continued.rounds).toHaveLength(2);
  expect(continued.rounds.every(round => Boolean(round.feedback))).toBe(true);
  expect(await officialSnapshot(page.request, own)).toEqual(before);
  await page.reload();
  await expect(page.getByRole("button", { name: "结束入梦", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "继续入梦", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "入梦开场", exact: true })).toBeHidden();
  await expect(page.getByLabel("基础说话方式", { exact: true })).toHaveValue(style);
  await expect(page.getByLabel("片段内容 1", { exact: true })).toHaveValue(`${fragmentText}不要反复追问。`);
  await expect(page.getByRole("checkbox", { name: "确认片段 1", exact: true })).toBeChecked();
  await expect(page.getByRole("article", { name: "梦中片段 1", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const persisted = (await readDream(page.request, own.id)).state!;
  await page.screenshot({ path: "design/previews/2026-11-12/dream-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "design/previews/2026-11-12/dream-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "结束入梦", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "确认人物变化", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(before.companion.speakingStyle);
  await expect(confirmation).toContainText(fragmentText);
  // Opening the confirmation must not apply anything yet.
  expect(await officialSnapshot(page.request, own)).toEqual(before);
  await expectNoHorizontalOverflow(page);
  const applied = dreamResponse(page, own.id, "apply");
  await confirmation.getByRole("button", { name: "确认应用并醒来", exact: true }).click();
  expect((await applied).status()).toBe(200);
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("已保存并醒来");
  await expect(page.getByRole("link", { name: "返回聊天，见见 TA", exact: true })).toBeVisible();
  const after = await officialSnapshot(page.request, own);
  expect(after.companion.speakingStyle).toBe(persisted.previewProfile.speakingStyle);
  expect(after.messages).toEqual(before.messages);
  expect(after.memories).toEqual(before.memories);
  // Restore through the visible initial version and its separate confirmation.
  await page.getByText("最初的设定", { exact: true }).locator("..").getByRole("button", { name: "恢复这一版", exact: true }).click();
  const restoreDialog = page.getByRole("dialog", { name: "确认恢复版本", exact: true });
  await expect(restoreDialog).toBeVisible();
  expect((await officialSnapshot(page.request, own)).companion.speakingStyle).toBe(after.companion.speakingStyle);
  const restored = dreamResponse(page, own.id, "restore");
  await restoreDialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  expect((await restored).status()).toBe(200);
  await expect(restoreDialog).not.toBeVisible();
  expect((await officialSnapshot(page.request, own)).companion.speakingStyle).toBe(before.companion.speakingStyle);
});

test("dream API requires a session for both reads and writes (no demo fallback)", async ({ request }) => {
  const path = `/api/companions/${crypto.randomUUID()}/dream`;
  for (const response of [await request.get(path), await postDream(request, path, { action: "start" })]) {
    const body = await json<{ error: string }>(response, 401);
    expect(body.error).toEqual(expect.any(String));
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});

test("dream API hides another user's companion as 404 without modifying its draft", async ({ playwright, baseURL }) => {
  const owner = await playwright.request.newContext({ baseURL });
  const stranger = await playwright.request.newContext({ baseURL });
  try {
    const own = await createOwnCompanion(owner);
    await createOwnCompanion(stranger);
    const path = `/api/companions/${own.id}/dream`;
    await act(owner, own.id, { action: "start" });
    const before = await json<unknown>(await owner.get(path));
    const missing = `/api/companions/${crypto.randomUUID()}/dream`;
    for (const method of ["get", "post"] as const) {
      const send = (target: string) => method === "post" ? postDream(stranger, target, { action: "start" }) : stranger.get(target);
      const hidden = await json<{ error: string }>(await send(path), 404);
      const absent = await json<{ error: string }>(await send(missing), 404);
      expect(hidden).toEqual(absent);
      expect(JSON.stringify(hidden)).not.toContain(own.name);
    }
    expect(await json<unknown>(await owner.get(path))).toEqual(before);
  } finally {
    await owner.dispose();
    await stranger.dispose();
  }
});

test("conflict recovery preserves an unsubmitted correction and explicitly reviews the latest profile", async ({ page }) => {
  const own = await createOwnCompanion(page.request);
  let state = (await act(page.request, own.id, { action: "start" })).state;
  state = (await act(page.request, own.id, { action: "generate", revision: state.revision, message: "今天有些累。", mode: "compare" })).state;
  await page.goto(`/dream/${own.id}`);
  await expect(page.getByRole("button", { name: "结束入梦", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "选择回声 1", exact: true }).click();
  const correction = "先关心吃饭，再问要不要休息，不连续追问。";
  await page.getByLabel("纠正这句回响", { exact: true }).fill(correction);
  const draftStyle = "另一标签保存的梦境表达";
  await act(page.request, own.id, { action: "edit", revision: state.revision, draftProfile: { ...state.draftProfile, speakingStyle: draftStyle }, fragments: [] });
  const stale = dreamResponse(page, own.id, "feedback");
  await page.getByRole("button", { name: "记录反馈", exact: true }).click();
  expect((await stale).status()).toBe(409);
  await page.getByRole("button", { name: "重新读取梦境", exact: true }).click();
  await expect(page.getByLabel("纠正这句回响", { exact: true })).toHaveValue(correction);
  await expect(page.getByLabel("基础说话方式", { exact: true })).toHaveValue(draftStyle);
  const feedback = dreamResponse(page, own.id, "feedback");
  await page.getByRole("button", { name: "记录反馈", exact: true }).click();
  expect((await feedback).status()).toBe(200);
  await page.getByRole("checkbox", { name: "确认片段 1", exact: true }).check();
  const save = dreamResponse(page, own.id, "edit");
  await page.getByRole("button", { name: "保存梦境草稿", exact: true }).click();
  expect((await save).status()).toBe(200);
  const latestStyle = "正式人物在其他标签更新的说话方式";
  await json(await page.request.patch(`/api/companions/${own.id}`, { data: { speakingStyle: latestStyle } }));
  await page.getByRole("button", { name: "结束入梦", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "确认人物变化", exact: true });
  const blocked = dreamResponse(page, own.id, "apply");
  await preview.getByRole("button", { name: "确认应用并醒来", exact: true }).click();
  expect((await blocked).status()).toBe(409);
  await page.getByRole("button", { name: "重新读取梦境", exact: true }).click();
  await page.getByRole("button", { name: "核对更新后的设定", exact: true }).click();
  const rebaseDialog = page.getByRole("dialog", { name: "确认最新人物基准", exact: true });
  await expect(rebaseDialog).toContainText(latestStyle);
  await expect(rebaseDialog).toContainText(draftStyle);
  const rebase = dreamResponse(page, own.id, "rebase");
  await rebaseDialog.getByRole("button", { name: "确认最新基准", exact: true }).click();
  expect((await rebase).status()).toBe(200);
  expect((await officialSnapshot(page.request, own)).companion.speakingStyle).toBe(latestStyle);
  await page.getByRole("button", { name: "结束入梦", exact: true }).click();
  const applied = dreamResponse(page, own.id, "apply");
  await page.getByRole("dialog", { name: "确认人物变化", exact: true }).getByRole("button", { name: "确认应用并醒来", exact: true }).click();
  expect((await applied).status()).toBe(200);
  expect((await officialSnapshot(page.request, own)).companion.speakingStyle).toContain(correction);
});

test("user export includes only owned dream snapshots and deleting the account clears them", async ({ request }) => {
  const own = await createOwnCompanion(request);
  const state = (await act(request, own.id, { action: "start" })).state;
  const exported = await json<{ dreamWorkspaces: Array<{ id: string; companionId: string }> }>(await request.get("/api/me/export"));
  expect(exported.dreamWorkspaces).toEqual([expect.objectContaining({ id: state.id, companionId: own.id })]);
  await json(await request.delete("/api/me/account", { data: { confirmation: "删除我的账号" } }));
  expect((await request.get(dreamPath(own.id))).status()).toBe(401);
});

test("echoes gallery previews both abilities with their distinct screen text and returns focus", async ({ page }) => {
  await page.goto("/echoes");
  // Decode the actual transparent asset before capturing the summoning frame.
  await page.evaluate(async () => {
    const image = new Image();
    image.src = "/visuals/yu-nianan-silhouette.png";
    await image.decode();
  });
  const birth = page.getByRole("button", { name: "发动生生不息", exact: true });
  const dream = page.getByRole("button", { name: "发动入梦", exact: true });
  for (const [trigger, kind, label, file] of [
    [birth, "renewal", "生生不息开场", "renewal-ability"],
    [dream, "dream", "入梦开场", "dream-ability"]
  ] as const) {
    await trigger.click();
    const overlay = page.getByRole("dialog", { name: label, exact: true });
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute("data-ability", kind);
    await expect(overlay).toHaveAttribute("data-phase", "playing");
    await expect(overlay).toContainText(kind === "dream" ? "我听到了【入梦】的回响" : "我看到了【生生不息】的激荡");
    // Pause actual CSS timelines at a reviewable frame, without replacing assets or DOM.
    await overlay.evaluate(node => {
      for (const animation of node.getAnimations({ subtree: true })) {
        animation.pause();
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration === "number") animation.currentTime = duration * (node.getAttribute("data-ability") === "renewal" ? 0.78 : 0.66);
      }
    });
    await page.screenshot({ path: `design/previews/2026-11-12/${file}.png` });
    await overlay.getByRole("button", { name: "跳过开场动画", exact: true }).click();
    await expect(overlay).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});
