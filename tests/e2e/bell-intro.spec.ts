import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "./fixtures";

test.describe("ability opening", () => {
  test("dream hall and short bell render finite audio with headroom and a clean ending", async ({ page }) => {
    const source = ts.transpileModule(
      readFileSync(resolve(process.cwd(), "src/lib/audio/giant-bell.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
    ).outputText;
    const renders = await page.evaluate(async (code) => {
      const exports = {} as { createGiantBellSound: (context: BaseAudioContext, options: {
        muted: boolean; reducedMotion: boolean; dream: boolean; duration: number;
      }) => GainNode };
      new Function("exports", code)(exports);
      return Promise.all([{ dream: true, duration: 6 }, { dream: false, duration: 2 }].map(async (options) => {
        const context = new OfflineAudioContext(2, 48_000 * options.duration, 48_000);
        exports.createGiantBellSound(context, { ...options, muted: false, reducedMotion: false });
        const buffer = await context.startRendering();
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);
        let peak = 0;
        let stereoDifference = 0;
        let finite = true;
        for (let i = 0; i < left.length; i++) {
          finite = finite && Number.isFinite(left[i]) && Number.isFinite(right[i]);
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
          stereoDifference += Math.abs(left[i] - right[i]);
        }
        return { ...options, peak, finite, stereoDifference, final: Math.max(Math.abs(left.at(-1)!), Math.abs(right.at(-1)!)) };
      }));
    }, source);
    for (const rendered of renders) {
      expect(rendered.finite).toBe(true);
      expect(rendered.peak).toBeGreaterThan(0.1);
      expect(rendered.peak).toBeLessThanOrEqual(0.86);
      expect(rendered.final).toBeLessThan(0.00001);
    }
    expect(renders[0].stereoDifference).toBeGreaterThan(0.1);
  });

  test("contract imports on the server without browser globals", () => {
    const source = ts.transpileModule(
      readFileSync(resolve(process.cwd(), "src/lib/ability-events.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
    ).outputText;
    const exports = {} as { playAbilityIntro: (request: { kind: string }) => void; dispatchAbilityIntro: unknown };
    new Function("exports", source)(exports);
    expect(() => exports.playAbilityIntro({ kind: "dream" })).not.toThrow();
    expect(exports.dispatchAbilityIntro).toBe(exports.playAbilityIntro);
  });

  test("async renewal auto-finishes silently and restores the chat field focus", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill("keep-chat@perpetual-renewal.local");
    await page.getByLabel("邮箱").focus();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false } });
      // Any attempt to start audio without a gesture is a test failure.
      Object.defineProperty(window, "AudioContext", { configurable: true, value: class {
        constructor() { document.documentElement.dataset.unexpectedAudio = "true"; throw new Error("No gesture"); }
      } });
      window.dispatchEvent(new CustomEvent("renewal:ability-intro", {
        detail: { kind: "renewal", companionName: "回响", autoPlay: true }
      }));
    });
    const intro = page.getByRole("dialog", { name: "生生不息开场", exact: true });
    await expect(intro).toBeVisible();
    await expect(intro).toHaveAttribute("data-phase", "playing");
    await expect(intro).toHaveAttribute("data-ability", "renewal");
    await expect(intro.getByRole("button", { name: "开启声音", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(intro.getByText("回响", { exact: true })).toBeVisible();
    await expect(intro).toBeHidden({ timeout: 8_000 });
    await expect(page.getByLabel("邮箱")).toBeFocused();
    await expect(page.getByLabel("邮箱")).toHaveValue("keep-chat@perpetual-renewal.local");
    expect(await page.evaluate(() => document.documentElement.dataset.unexpectedAudio)).toBeUndefined();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("gesture dream replaces previous audio and rapid requests leave only the latest timer", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("邮箱").focus();
    await page.evaluate(() => {
      const OriginalAudioContext = window.AudioContext;
      let created = 0;
      let closed = 0;
      window.AudioContext = class extends OriginalAudioContext {
        constructor() { super(); document.documentElement.dataset.audioCreated = String(++created); }
        override close() { document.documentElement.dataset.audioClosed = String(++closed); return super.close(); }
      };
      const button = document.createElement("button");
      button.textContent = "test dream gesture";
      button.onclick = () => {
        for (const kind of ["renewal", "dream"]) window.dispatchEvent(new CustomEvent("renewal:ability-intro", {
          detail: { kind, short: true, autoPlay: true }
        }));
      };
      document.body.append(button);
    });
    await page.getByRole("button", { name: "test dream gesture" }).click();
    const intro = page.getByRole("dialog", { name: "入梦开场", exact: true });
    await expect(intro).toBeVisible();
    await expect(intro).toHaveAttribute("data-ability", "dream");
    await expect(intro).toHaveAttribute("data-short", "true");
    await expect(intro.locator("p").filter({ hasText: "我听到了" }).first()).toHaveText("我听到了【入梦】的回响");
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.dataset.audioCreated)).toBe("2");
    expect(await page.evaluate(() => document.documentElement.dataset.audioClosed)).toBe("1");
    await page.keyboard.press("Escape");
    await expect(intro).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.dataset.audioClosed)).toBe("2");
    await page.getByLabel("邮箱").focus();
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("renewal:ability-intro", { detail: { kind: "dream", short: true, autoPlay: true } }));
    });
    await expect(intro).toBeVisible();
    await expect(intro).toBeHidden({ timeout: 4_000 });
    await expect(page.getByLabel("邮箱")).toBeFocused();
  });

  for (const failure of ["missing", "slow"]) {
    test(`${failure} images keep a usable fallback without blocking dream playback`, async ({ page }) => {
      await page.route("**/visuals/bell-*.png", async (route) => {
        if (failure === "missing") await route.abort();
        else { await new Promise((resolve) => setTimeout(resolve, 2_000)); await route.continue().catch(() => {}); }
      });
      await page.goto("/login");
      await page.getByLabel("邮箱").focus();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("renewal:ability-intro", {
        detail: { kind: "dream", autoPlay: true }
      })));
      const intro = page.getByRole("dialog", { name: "入梦开场", exact: true });
      await expect(intro).toBeVisible();
      // After the asset deadline the procedural scene stays stable even on late success.
      await page.waitForTimeout(2_300);
      await expect(intro.locator('[class*="artwork"]')).not.toHaveClass(/loaded/);
      await expect(intro.locator("p").filter({ hasText: "我听到了" }).first()).toBeVisible();
      await intro.getByRole("button", { name: "跳过开场动画" }).click();
      await expect(intro).toBeHidden();
      await expect(page.getByLabel("邮箱")).toBeFocused();
    });
  }

  test("reduced motion dream can replay without hiding or clearing the underlying field", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await page.getByLabel("邮箱").fill("dream@perpetual-renewal.local");
    await page.getByLabel("邮箱").focus();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("renewal:ability-intro", { detail: { kind: "dream" } })));
    const intro = page.getByRole("dialog", { name: "入梦开场", exact: true });
    await expect(intro).toHaveAttribute("data-reduced-motion", "true");
    await intro.getByRole("button", { name: "进入", exact: true }).press("Enter");
    await expect(intro).toBeHidden({ timeout: 3_000 });
    await expect(page.getByLabel("邮箱")).toHaveValue("dream@perpetual-renewal.local");
    await expect(page.getByLabel("邮箱")).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new Event("renewal:replay-intro")));
    const brand = page.getByRole("dialog", { name: "生生不息开场", exact: true });
    await expect(brand).toHaveAttribute("data-ability", "renewal");
    await brand.getByRole("button", { name: "跳过开场动画" }).click();
    await expect(page.getByLabel("邮箱")).toBeFocused();
  });
});

test.describe("bell opening", () => {
  test.use({ showIntro: true });

  test("first visit renders the intro text and skipping persists across reload", async ({ page }, testInfo) => {
    await page.goto("/login");
    const source = ts.transpileModule(
      readFileSync(resolve(process.cwd(), "src/lib/audio/giant-bell.ts"), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
    ).outputText;
    const audio = await page.evaluate(async (code) => {
      const exports = {} as {
        createGiantBellSound: (
          context: BaseAudioContext,
          options: { muted: boolean; reducedMotion: boolean }
        ) => GainNode;
      };
      // Run the actual import-free helper in the browser's real Web Audio engine.
      new Function("exports", code)(exports);
      async function render(muted: boolean) {
        const sampleRate = 48_000;
        const context = new OfflineAudioContext(2, sampleRate * 5, sampleRate);
        const master = exports.createGiantBellSound(context, { muted, reducedMotion: false });
        const masterGain = master.gain.value;
        const buffer = await context.startRendering();
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => {
          const samples = buffer.getChannelData(index);
          let peak = 0;
          let finite = true;
          for (const sample of samples) {
            finite = finite && Number.isFinite(sample);
            peak = Math.max(peak, Math.abs(sample));
          }
          function rms(start: number, end: number) {
            const first = Math.round(start * sampleRate);
            const last = Math.round(end * sampleRate);
            let energy = 0;
            for (let i = first; i < last; i++) energy += samples[i] * samples[i];
            return Math.sqrt(energy / (last - first));
          }
          return {
            finite,
            peak,
            firstStrikeRms: rms(0, 0.2),
            beforeSecondStrikeRms: rms(1.95, 2.15),
            secondStrikeRms: rms(2.15, 2.35),
            finalSample: samples[samples.length - 1]
          };
        });
        return {
          sampleRate: buffer.sampleRate,
          frames: buffer.length,
          masterGain,
          channels
        };
      }
      return { audible: await render(false), muted: await render(true) };
    }, source);
    await testInfo.attach("giant-bell-offline-audio", {
      body: JSON.stringify(audio, null, 2),
      contentType: "application/json"
    });
    for (const rendered of [audio.audible, audio.muted]) {
      expect(rendered.sampleRate).toBe(48_000);
      expect(rendered.frames).toBe(240_000);
      expect(rendered.channels).toHaveLength(2);
      for (const channel of rendered.channels) expect(channel.finite).toBe(true);
    }
    expect(audio.audible.masterGain).toBeCloseTo(0.85, 2);
    for (const channel of audio.audible.channels) {
      expect(channel.peak).toBeGreaterThan(0.1);
      // The 0.85 master and 0.94 limiter leave headroom below this ceiling.
      expect(channel.peak).toBeLessThanOrEqual(0.86);
      expect(channel.firstStrikeRms).toBeGreaterThan(0.04);
      expect(channel.secondStrikeRms).toBeGreaterThan(0.04);
      expect(channel.secondStrikeRms).toBeGreaterThan(channel.beforeSecondStrikeRms);
      expect(Math.abs(channel.finalSample)).toBeLessThan(0.00001);
    }
    expect(audio.muted.masterGain).toBe(0);
    for (const channel of audio.muted.channels) expect(channel.peak).toBe(0);
    const intro = page.getByRole("dialog", { name: "生生不息开场", exact: true });
    await expect(intro).toBeVisible();
    await expect(intro.locator("p").filter({ hasText: "我看到了" }).first()).toHaveText(
      "我看到了【生生不息】的激荡"
    );
    await expect(intro.getByText("只要想念，就会想见", { exact: true })).toBeVisible();
    await expect(intro.getByRole("button", { name: "进入", exact: true })).toBeEnabled();
    await page.evaluate(async () => {
      await Promise.all(["/visuals/bell-scene.png", "/visuals/bell-isolated.png"].map((src) => {
        const image = new Image();
        image.src = src;
        return image.decode();
      }));
    });
    await expect(intro.locator('[class*="artwork"]')).toHaveClass(/loaded/);
    await page.screenshot({ path: "design/previews/2026-11-02/intro-implemented.png", animations: "disabled" });

    await intro.getByRole("button", { name: "跳过开场动画", exact: true }).click();
    await expect(intro).toBeHidden();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("renewal:intro-seen:v1"))).toBe("1");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(intro).toBeHidden();
    await expect(page.getByLabel("邮箱")).toBeEditable();
    expect(await page.evaluate(() => sessionStorage.getItem("renewal:intro-seen:v1"))).toBe("1");
  });

  test("reduced motion keeps both skip and keyboard entry usable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    const intro = page.getByRole("dialog", { name: "生生不息开场", exact: true });
    await expect(intro).toBeVisible();
    await expect(intro).toHaveAttribute("data-reduced-motion", "true");
    await expect(intro.getByRole("button", { name: "进入", exact: true })).toBeFocused();
    const mute = intro.getByRole("button", { name: "静音", exact: true });
    await expect(mute).toHaveAttribute("aria-pressed", "false");
    await mute.click();
    const unmute = intro.getByRole("button", { name: "开启声音", exact: true });
    await expect(unmute).toHaveAttribute("aria-pressed", "true");
    await unmute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "false");
    await intro.getByRole("button", { name: "跳过开场动画", exact: true }).click();
    await expect(intro).toBeHidden();
    await page.getByLabel("邮箱").fill("reduced-motion@perpetual-renewal.local");

    await page.evaluate(() => window.dispatchEvent(new Event("renewal:replay-intro")));
    await expect(intro).toBeVisible();
    const enter = intro.getByRole("button", { name: "进入", exact: true });
    await expect(enter).toBeFocused();
    await enter.press("Enter");
    await expect(intro).toBeHidden({ timeout: 5_000 });
    await expect(page.getByLabel("邮箱")).toHaveValue("reduced-motion@perpetual-renewal.local");
    await expect(page.getByLabel("邮箱")).toBeEditable();
  });

  test("replay event reopens a skipped intro and Escape returns to the page", async ({ page }) => {
    await page.goto("/login");
    const intro = page.getByRole("dialog", { name: "生生不息开场", exact: true });
    await expect(intro).toBeVisible();
    await intro.getByRole("button", { name: "跳过开场动画", exact: true }).click();
    await expect(intro).toBeHidden();
    await page.getByLabel("邮箱").fill("replay@perpetual-renewal.local");

    await page.evaluate(() => window.dispatchEvent(new Event("renewal:replay-intro")));
    await expect(intro).toBeVisible();
    await expect(intro.getByRole("button", { name: "进入", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(intro).toBeHidden();
    await expect(page.getByLabel("邮箱")).toHaveValue("replay@perpetual-renewal.local");
    await page.getByLabel("邮箱").fill("returned@perpetual-renewal.local");
    await expect(page.getByLabel("邮箱")).toHaveValue("returned@perpetual-renewal.local");
  });
});

test("workspace chat and profile drawer remain usable on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const companionName = `回响${unique}`;
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(`responsive-${unique}@perpetual-renewal.local`);
  await page.getByLabel("昵称").fill("响应式体验");
  await page.getByRole("button", { name: "进入", exact: true }).click();
  await expect(page).toHaveURL("/");

  const created = await page.request.post("/api/companions", {
    data: {
      name: companionName,
      relationshipKind: "CUSTOM",
      customKind: "朋友",
      speakingStyle: "温柔自然",
      proactiveMessagesEnabled: false
    }
  });
  expect(created.status()).toBe(201);
  const { companion } = await created.json();
  await page.reload();
  await page.getByTitle(`切换到 ${companionName}`, { exact: true }).click();
  await expect(page.getByRole("heading", { name: companionName, exact: true })).toBeVisible();
  const composer = page.getByPlaceholder("把想说的话放在这里");
  const message = "今天想和你聊聊天。";
  await composer.fill(message);
  const sent = page.waitForResponse((response) =>
    response.url().endsWith(`/api/conversations/${companion.conversationId}/messages`) &&
    response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = await sent;
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.completion.provider).toBe("mock");
  expect(payload.assistantMessage.content).toContain(message);
  const chat = page.getByRole("region", { name: "聊天", exact: true });
  await expect(chat.getByText(message, { exact: true })).toBeVisible();
  await expect(chat.getByText(payload.assistantMessage.content, { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(composer).toBeInViewport();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  )).toBe(true);
  await page.screenshot({ path: "design/previews/2026-11-02/desktop-implemented.png", animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(composer).toBeVisible();
  await expect(composer).toBeInViewport();
  await expect(chat.getByText(payload.assistantMessage.content, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  )).toBe(true);
  await page.screenshot({ path: "design/previews/2026-11-02/mobile-implemented.png", animations: "disabled" });

  const drawer = page.getByRole("dialog", { name: "关系资料", exact: true });
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "关系资料", exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "关系资料", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭关系资料", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(composer).toBeInViewport();
  await composer.fill("回来继续聊。");
  await expect(composer).toHaveValue("回来继续聊。");
});
