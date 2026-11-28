// Offline component harness: no app server, accounts, database or outbound requests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const packageFile = (pkg, file) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), file);
const aliases = {
  react: packageFile("react", "cjs/react.production.js"),
  "react/jsx-runtime": packageFile("react", "cjs/react-jsx-runtime.production.js"),
  "react-dom": packageFile("react-dom", "cjs/react-dom.production.js"),
  "react-dom/client": packageFile("react-dom", "cjs/react-dom-client.production.js"),
  scheduler: packageFile("scheduler", "cjs/scheduler.production.js")
};
const modules = {};
function collect(filename) {
  if (modules[filename]) return filename;
  const entry = modules[filename] = { code: "", imports: {} };
  if (filename.endsWith(".css")) {
    entry.code = 'module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };';
    return filename;
  }
  const text = readFileSync(filename, "utf8");
  entry.code = /\.tsx?$/.test(filename) ? ts.transpileModule(text, {
    fileName: filename,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText : text;
  for (const match of entry.code.matchAll(/require\(["']([^"']+)["']\)/g)) {
    const specifier = match[1];
    let dependency = aliases[specifier];
    if (!dependency && specifier.startsWith("@/")) dependency = path.join(root, "src", specifier.slice(2));
    if (!dependency && specifier.startsWith(".")) dependency = path.resolve(path.dirname(filename), specifier);
    if (!dependency) throw new Error(`Unexpected browser dependency: ${specifier}`);
    if (!/\.(js|ts|tsx|css)$/.test(dependency)) {
      dependency += specifier.includes("silhouette") ? ".tsx" : ".ts";
    }
    entry.imports[specifier] = collect(dependency);
  }
  return filename;
}
const component = collect(path.join(root, "src/components/bell-intro.tsx"));
const react = collect(aliases.react);
const client = collect(aliases["react-dom/client"]);
const bundle = `(() => {
  const modules = ${JSON.stringify(modules)}, cache = {};
  function load(id) {
    if (cache[id]) return cache[id].exports;
    const module = cache[id] = { exports: {} }, entry = modules[id];
    new Function('require', 'module', 'exports', entry.code)(name => load(entry.imports[name]), module, module.exports);
    return module.exports;
  }
  const seen = new Map([['renewal:intro-seen:v1', '1']]);
  Object.defineProperty(window, 'sessionStorage', { value: { getItem: key => seen.get(key), setItem: (k,v) => seen.set(k,v) } });
  Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false } });
  window.introStates = [];
  window.addEventListener('renewal:ability-state', e => window.introStates.push(e.detail.active));
  window.fixtureRoot = load(${JSON.stringify(client)}).createRoot(document.getElementById('root'));
  window.fixtureRoot.render(load(${JSON.stringify(react)}).createElement(load(${JSON.stringify(component)}).BellIntro));
})();`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await page.setContent('<input aria-label="聊天" value="保留输入"><div id="root"></div>');
    await page.addStyleTag({ content: readFileSync(path.join(root, "src/components/bell-intro.module.css"), "utf8") });
    await page.addScriptTag({ content: bundle });
    await expect(page.locator("dialog")).toBeAttached();
    await page.clock.install();
    await page.clock.fastForward(150);
    const field = page.getByLabel("聊天");
    await field.focus();
    const dispatch = requests => page.evaluate(values => {
      for (const detail of values) window.dispatchEvent(new CustomEvent("renewal:ability-intro", { detail }));
    }, requests);
    const intro = page.locator("dialog");
    await dispatch([{ kind: "toString" }, { kind: "unregistered" }]);
    await expect(intro).not.toHaveAttribute("open");
    // Same-tick bursts must show every request, keeping the underlying UI paused.
    await dispatch([{ kind: "renewal", autoPlay: true }, { kind: "dream", short: true, autoPlay: true }, { kind: "renewal" }]);
    await expect(intro).toHaveAttribute("data-ability", "renewal");
    await expect(intro).toHaveAttribute("data-active", "true");
    await expect(intro).toHaveAttribute("data-run", "1");
    await expect(intro).toHaveAttribute("data-queue-length", "2");
    await expect(intro.locator(".srOnly")).toHaveText("我看到了【生生不息】的激荡");
    await page.clock.fastForward(5_900);
    await expect(intro).toHaveAttribute("data-ability", "renewal");
    await page.clock.fastForward(100);
    await expect(intro).toHaveAttribute("data-ability", "dream");
    await expect(intro).toHaveAttribute("data-run", "2");
    await expect(intro).toHaveAttribute("data-queue-length", "1");
    await expect(intro.locator(".srOnly")).toHaveText("我听到了【入梦】的回响");
    await expect(intro.getByRole("button", { name: "开启声音", exact: true })).toHaveAttribute("aria-pressed", "true");
    assert(!(await page.evaluate(() => window.introStates)).includes(false));
    await page.clock.fastForward(1_900);
    await expect(intro).toHaveAttribute("data-ability", "dream");
    await page.clock.fastForward(100);
    await expect(intro).toHaveAttribute("data-ability", "renewal");
    await expect(intro).toHaveAttribute("data-phase", "ready");
    await expect(intro).toHaveAttribute("data-active", "true");
    await expect(intro).toHaveAttribute("data-run", "3");
    await expect(intro).toHaveAttribute("data-queue-length", "0");
    await intro.getByRole("button", { name: "跳过开场动画" }).click();
    await expect(intro).not.toHaveAttribute("open");
    await expect(intro).toHaveAttribute("data-active", "false");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("保留输入");
    assert.equal((await page.evaluate(() => window.introStates)).at(-1), false);
    // Escape skips only the current scene; the following request remains available.
    await dispatch([{ kind: "dream" }, { kind: "renewal", autoPlay: true, short: true }]);
    await expect(intro).toHaveAttribute("data-ability", "dream");
    await page.keyboard.press("Escape");
    await expect(intro).toHaveAttribute("data-ability", "renewal");
    await page.keyboard.press("Escape");
    await expect(intro).not.toHaveAttribute("open");
    await expect(field).toBeFocused();
    // Existing replay/session key, reduced motion, mute and cleanup contracts.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.dispatchEvent(new Event("renewal:replay-intro")));
    await expect(intro).toHaveAttribute("data-reduced-motion", "true");
    await expect(intro.getByRole("button", { name: "进入", exact: true })).toBeFocused();
    await intro.getByRole("button", { name: "静音", exact: true }).click();
    await expect(intro.getByRole("button", { name: "开启声音", exact: true })).toHaveAttribute("aria-pressed", "true");
    await intro.getByRole("button", { name: "进入", exact: true }).click();
    await expect(intro).toHaveAttribute("data-phase", "playing");
    await page.clock.fastForward(800);
    await expect(intro).not.toHaveAttribute("open");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("renewal:intro-seen:v1")), "1");
    await dispatch([{ kind: "dream", autoPlay: true }, { kind: "renewal" }]);
    await page.evaluate(() => window.fixtureRoot.unmount());
    assert.equal((await page.evaluate(() => window.introStates)).at(-1), false);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS offline ability intro ${viewport.width}px: FIFO, 6s/2s/800ms, skip, focus, replay, mute, cleanup`);
  }
} finally {
  await browser.close();
}
