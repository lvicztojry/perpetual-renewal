import type { APIRequestContext, APIResponse } from "@playwright/test";
import { test, expect } from "./fixtures";
import type { JourneyInput, JourneyResponse } from "../../src/lib/journey/types";

// The controller supplies an isolated memory/local-email server with a dummy LLM.
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
  const groups = await json<{ groups: Array<{ id: string }> }>(await api.get("/api/groups"));
  return Promise.all(people.companions.map(async person => ({
    person,
    messages: await json(await api.get(`/api/conversations/${person.conversationId}/messages`)),
    dream: await json(await api.get(`/api/companions/${person.id}/dream`))
  }))).then(rows => ({ rows, groups: groups.groups }));
}

test.beforeEach(async ({ baseURL }) => {
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL!).hostname);
  expect(process.env.E2E_REAL_PROVIDER).not.toBe("1");
  expect(process.env.E2E_REPOSITORY ?? "memory").toBe("memory");
  expect(process.env.E2E_AUTH_MODE ?? "local-email").toBe("local-email");
});

test("journey requires authentication and a trusted origin; stale revisions cannot overwrite progress", async ({ request, baseURL }) => {
  expect((await request.get("/api/me/journey")).status()).toBe(401);
  await login(request);
  const initial = await read(request);
  expect(initial.journey).toMatchObject({ version: 2, status: "active", step: "awakening", activeCourse: null });
  const untrustedHeaders: Array<Record<string, string>> = [{}, { origin: "https://untrusted.invalid" }];
  for (const headers of untrustedHeaders) {
    expect((await request.post("/api/me/journey", { headers, data: { action: "course-start", courseId: "main" } })).status()).toBe(403);
  }
  expect(await read(request)).toEqual(initial);
  const started = await act(request, { action: "course-start", courseId: "main", mode: "first", expectedRevision: initial.journey.revision });
  expect(started.journey.activeCourse).toMatchObject({ id: "main", stepId: "awakening-greet", mode: "first" });
  const confirmed = await act(request, { action: "course-confirm", courseId: "main", stepId: "awakening-greet", expectedRevision: started.journey.revision });
  expect(confirmed.journey.activeCourse?.stepId).toBe("awakening-answer");
  const stale = await json<JourneyResponse>(await request.post("/api/me/journey", {
    headers: { origin: new URL(baseURL!).origin },
    data: { action: "course-leave", result: "skipped", expectedRevision: started.journey.revision }
  }), 409);
  expect(stale.journey).toEqual(confirmed.journey);
  expect(await read(request)).toEqual(confirmed);
});

test("course endpoints reject unknown courses, steps and forged evidence", async ({ request }) => {
  await login(request);
  const initial = await read(request);
  const post = (data: Record<string, unknown>) => request.post("/api/me/journey", {
    headers: { origin: origins.get(request)! }, data: { expectedRevision: initial.journey.revision, ...data }
  });
  expect((await post({ action: "course-start", courseId: "not-a-course" })).status()).toBe(400);
  expect((await post({ action: "course-confirm", courseId: "main", stepId: "no-such-step" })).status()).toBe(400);
  expect((await post({ action: "course-confirm", courseId: "main", stepId: "awakening-greet", unknown: 1 })).status()).toBe(400);
  expect((await read(request)).journey.revision).toBe(initial.journey.revision);
  // A confirmation for a step that is not the active one is refused.
  const started = await act(request, { action: "course-start", courseId: "main", mode: "first", expectedRevision: initial.journey.revision });
  expect((await request.post("/api/me/journey", {
    headers: { origin: origins.get(request)! },
    data: { action: "course-confirm", courseId: "main", stepId: "creation-submit", evidence: "companion-created", expectedRevision: started.journey.revision }
  })).status()).toBe(400);
});

test("a new account is invited in, walks the main line, creates a person, chats, enters a dream and finishes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page.request);
  const before = await snapshot(page.request);
  await page.goto("/");
  const card = page.locator("[data-guide-card]");
  await expect(card).toBeVisible();
  await expect(card).toContainText("初醒 · 有人等你");
  await expect(card.getByRole("dialog")).toHaveCount(0);
  expect((await read(page.request)).journey.activeCourse).toMatchObject({ id: "main", stepId: "awakening-greet" });
  // The highlight tracks the guide card's own step, never a guessed element.
  await expect(card).toHaveAttribute("data-step-id", "awakening-greet");

  // Desktop, phone portrait, narrow phone, phone landscape, and the CSS viewport a
  // 200% browser zoom leaves on a 1365×900 screen (zoom is not emulable directly).
  const shots: Array<{ width: number; height: number; kind: string }> = [
    { width: 1365, height: 900, kind: "desktop" },
    { width: 682, height: 450, kind: "desktop-200pct" },
    { width: 390, height: 844, kind: "mobile" },
    { width: 320, height: 568, kind: "narrow" },
    { width: 844, height: 390, kind: "mobile-landscape" }
  ];
  for (const { width, height, kind } of shots) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(160);
    const bounds = await card.boundingBox();
    expect(await card.isVisible(), `${kind}: card visible`).toBe(true);
    expect(bounds, `${kind}: card bounds`).not.toBeNull();
    // Card must sit inside the visual viewport, after the keyboard/zoom adjustments.
    const viewport = await page.evaluate(() => ({
      width: window.visualViewport?.width ?? innerWidth,
      height: window.visualViewport?.height ?? innerHeight
    }));
    expect(bounds!.x, `${kind}: left`).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width, `${kind}: right`).toBeLessThanOrEqual(viewport.width + 2);
    expect(bounds!.y, `${kind}: top`).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height, `${kind}: bottom`).toBeLessThanOrEqual(viewport.height + 2);
    // No horizontal overflow at any of these sizes.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${kind}: no sideways scroll`).toBe(true);
    // The card's own controls stay reachable and never clip horizontally.
    expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${kind}: card fits`).toBe(true);
    // Every control keeps a 44×44 CSS px tap target.
    const small = await card.evaluate(node => Array.from(node.querySelectorAll<HTMLElement>("button"))
      .filter(button => button.getClientRects().length > 0)
      .map(button => { const box = button.getBoundingClientRect(); return { label: button.textContent?.trim() ?? button.ariaLabel, w: Math.round(box.width), h: Math.round(box.height) }; })
      .filter(box => box.w < 44 || box.h < 44));
    expect(small, `${kind}: tap targets under 44px`).toEqual([]);
    // Evidence lives beside earlier preview rounds, so it survives log cleanup.
    await page.screenshot({ path: `design/previews/2026-11-28/journey-v2/journey-${kind}.png` });
  }
  // A phone rotated, then back: geometry must follow, never keep stale coordinates.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(120);
  const landscape = await card.boundingBox();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  const portrait = await card.boundingBox();
  expect(landscape!.width).toBeLessThan(844);
  expect(portrait!.width).toBeLessThan(390);
  // Phones show either the rail or the chat pane, so the walked flow runs at desktop width.
  await page.setViewportSize({ width: 1365, height: 900 });

  // Greeting, then the story-only answer: it never leaves the browser.
  await card.getByRole("button", { name: "继续", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "awakening-answer");
  await card.getByRole("button", { name: "暂时不想说", exact: true }).click();
  await expect(card).toContainText("名字和往事，都可以留在你心里");
  await card.getByRole("button", { name: "继续", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "awakening-walk");
  expect(await snapshot(page.request)).toEqual(before);
  await card.getByRole("button", { name: "继续", exact: true }).click();

  // Reading steps of the arrival chapter point at real regions.
  for (const [stepId, target] of [["arrival-people", "people-list"], ["arrival-chat", "chat-region"], ["arrival-tools", "chat-tools"]] as const) {
    await expect(card).toHaveAttribute("data-step-id", stepId);
    await expect(page.locator(`[data-guide="${target}"]`).first()).toBeVisible();
    await card.getByRole("button", { name: "知道了", exact: true }).click();
  }

  // The lantern entry is a real navigation: clicking it moves the page and advances.
  await expect(card).toHaveAttribute("data-step-id", "lanterns-entry");
  await page.locator('[data-guide="open-groups"]').click();
  await expect(page).toHaveURL(/\/groups/);
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId).toBe("lanterns-pack");
  // With no group yet, the starter pack is the honest path, and it really creates one.
  await expect(card).toHaveAttribute("data-step-id", "lanterns-pack");
  await page.locator('[data-guide="lanterns-pack"]').click();
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId).toBe("lanterns-install");
  await page.locator('[data-guide="lanterns-install"]').click();
  await expect(page).toHaveURL(/\/groups\/starter-/);
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId, { timeout: 20000 }).toBe("lanterns-read");
  expect((await snapshot(page.request)).groups).toHaveLength(1);
  await expect(card).toHaveAttribute("data-step-id", "lanterns-read");
  await card.getByRole("button", { name: "知道了", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "lanterns-continue");
  await page.locator('[data-guide="group-to-create"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId).toBe("creation-open");

  // Creation runs through the real entry, the real form and the real POST.
  await page.locator('[data-guide="create-person"]').click();
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId).toBe("creation-kind");
  // The relationship type is a real choice in the real form.
  await expect(card).toHaveAttribute("data-step-id", "creation-kind");
  await page.getByRole("button", { name: /朋友/ }).first().click();
  await card.getByRole("button", { name: "写好了", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "creation-name");
  const name = `归灯${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("名字", { exact: true }).fill(name);
  await card.getByRole("button", { name: "写好了", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "creation-addresses");
  await page.getByLabel("具体关系", { exact: true }).fill("久别重逢的朋友");
  await card.getByRole("button", { name: "写好了", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "creation-style");
  await page.getByLabel("性格关键词", { exact: true }).fill("平实、耐心");
  await card.getByRole("button", { name: "写好了", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "creation-submit");

  const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/companions" && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建并开始聊天", exact: true }).last().click();
  const created = await json<{ companion: { id: string; conversationId: string } }>(await createdResponse, 201);
  const person = created.companion;
  // The evidence gate: the step advances only after the server re-checks the created person.
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId, { timeout: 20000 }).toBe("conversation-focus");
  expect((await read(page.request)).journey.companionId).toBe(person.id);
  await card.getByRole("button", { name: "继续", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "conversation-input");
  await page.getByPlaceholder("把想说的话放在这里").fill("你好，我们可以从今天的小事说起。");
  await card.getByRole("button", { name: "写好了", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "conversation-send");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  // Sending is recorded first; when the reply also lands immediately the guide advances
  // through the wait step by itself instead of asking for an action already done.
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId, { timeout: 20000 }).toMatch(/conversation-reply|dream-open/);
  const saved = await json<{ messages: Array<{ role: string; content: string }> }>(await page.request.get(`/api/conversations/${person.conversationId}/messages`));
  expect(saved.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user", content: "你好，我们可以从今天的小事说起。" })]));
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId, { timeout: 20000 }).toBe("dream-open");
  await page.locator('[data-guide="open-dream"]').click();
  await expect(page).toHaveURL(`/dream/${person.id}`);
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId).toBe("dream-start");

  // Entering a dream is only the opening: generating and feedback are still required.
  await page.getByRole("button", { name: "进入梦境", exact: true }).click();
  const intro = page.getByRole("dialog", { name: "入梦开场", exact: true });
  if (await intro.isVisible()) await intro.getByRole("button", { name: "跳过开场动画", exact: true }).click();
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId, { timeout: 20000 }).toBe("dream-situation");
  expect((await read(page.request)).journey.status).toBe("active");
  await page.getByLabel("梦中情境").fill("我今天有点累。");
  await card.getByRole("button", { name: "写好了", exact: true }).click();
  await expect(card).toHaveAttribute("data-step-id", "dream-generate");
  await page.getByRole("button", { name: "听听回响", exact: true }).click();
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId, { timeout: 30000 }).toBe("dream-feedback");
  // Feedback: pick the echo that sounds most like the person. The pure-correction path
  // (typing a replacement sentence) is covered by the isolated service test.
  await page.getByRole("button", { name: "选择回声 1", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "记录反馈", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "记录反馈", exact: true }).click();
  await expect.poll(async () => (await read(page.request)).journey.activeCourse?.stepId, { timeout: 20000 }).toBe("dream-review");
  // Leaving the remaining reading steps alone keeps the course resumable.
  const dreamState = await json<{ state: { status: string } | null }>(await page.request.get(`/api/companions/${person.id}/dream`));
  expect(dreamState.state?.status).toBe("draft");

  const completedResources = await snapshot(page.request);
  await card.getByRole("button", { name: "暂歇", exact: true }).click();
  await expect(card).toBeHidden();
  const paused = await read(page.request);
  expect(paused.journey.activeCourse).toBeNull();
  expect(paused.journey.courses.main.result).toBe("deferred");
  await page.reload();
  await expect(card).toBeHidden();
  expect(await read(page.request)).toEqual(paused);
  await expect(page.getByRole("button", { name: "找余念安", exact: true }).first()).toBeVisible();
  expect(await snapshot(page.request)).toEqual(completedResources);
});
