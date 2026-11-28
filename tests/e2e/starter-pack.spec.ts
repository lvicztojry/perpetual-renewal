import { test, expect } from "./fixtures";

test("starter install requires authentication and a same-origin request", async ({ request, baseURL }) => {
  expect((await request.post("/api/starters", { headers: { origin: new URL(baseURL!).origin } })).status()).toBe(401);
  await request.post("/api/auth/login", { data: { email: "starter-auth-" + crypto.randomUUID() + "@perpetual-renewal.local", nickname: "初始人物验收" } });
  expect((await request.post("/api/starters")).status()).toBe(403);
  expect((await request.post("/api/starters", { headers: { origin: "https://untrusted.invalid" } })).status()).toBe(403);
  const result = await (await request.get("/api/companions")).json();
  expect(result.companions).toHaveLength(0);
});

test("preview installs six contacts and a group, retries preserve edits and private history stays empty", async ({ page, baseURL }) => {
  await page.request.post("/api/auth/login", { data: { email: "starter-ui-" + crypto.randomUUID() + "@perpetual-renewal.local", nickname: "初始人物界面验收" } });
  await page.goto("/");
  await page.getByRole("button", { name: "认识留灯会" }).click();
  const preview = page.getByRole("dialog", { name: "留灯会" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("link", { name: "故事背景" })).toHaveAttribute("href", "/story");
  for (const name of ["林晚", "赵川", "许闻", "叶岑", "唐小满", "陈序"]) await expect(preview.getByText(new RegExp(name + " ·"))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).not.toBeVisible();
  await expect(page.getByRole("button", { name: "认识留灯会" })).toBeFocused();
  await page.getByRole("button", { name: "认识留灯会" }).click();
  await preview.getByRole("button", { name: "添加人物，进入留灯会" }).click();
  await page.waitForURL(/\/groups\/starter-/);
  await expect(page.getByRole("heading", { name: "留灯会", exact: true })).toBeVisible();
  const people = (await (await page.request.get("/api/companions")).json()).companions;
  expect(people).toHaveLength(6);
  const person = people.find((c: { name: string }) => c.name === "林晚");
  const messages = (await (await page.request.get("/api/conversations/" + person.conversationId + "/messages")).json()).messages;
  expect(messages).toHaveLength(1);
  expect(messages[0].role).toBe("assistant");
  await page.request.patch("/api/companions/" + person.id, { data: { name: "修改过的林晚" } });
  const retry = await page.request.post("/api/starters", { headers: { origin: new URL(baseURL!).origin } });
  expect(retry.ok()).toBeTruthy();
  const after = (await (await page.request.get("/api/companions")).json()).companions;
  expect(after).toHaveLength(6);
  expect(after.find((c: { id: string }) => c.id === person.id).name).toBe("修改过的林晚");
});

test("starter preview fits a narrow screen and can be closed", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "starter-mobile-" + crypto.randomUUID() + "@perpetual-renewal.local", nickname: "手机验收" } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/groups");
  await page.getByRole("button", { name: "认识留灯会" }).click();
  const preview = page.getByRole("dialog", { name: "留灯会" });
  await expect(preview).toBeVisible();
  const rect = await preview.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await preview.getByRole("button", { name: "关闭人物介绍" }).click();
  await expect(preview).not.toBeVisible();
  await page.goto("/story");
  await expect(page.getByRole("heading", { name: "从一个想见的人开始" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回聊天" })).toHaveAttribute("href", "/");
});
