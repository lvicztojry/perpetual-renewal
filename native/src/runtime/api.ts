import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "@tauri-apps/api/core";
import { NextRequest } from "./next-server";
import { deleteLocalAccount, exclusive, localSession, persistActiveState, reloadActiveState, requireLocalSession } from "./account";
import { snapshot } from "./codec";
import { markLocalRequest } from "./request-origin";

type RouteModule = Record<string, (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>>;
const modules = import.meta.glob<RouteModule>(["../../../src/app/api/**/route.ts", "!../../../src/app/api/auth/**/route.ts", "!../../../src/app/api/proactive/groups/run/route.ts"]);
const routes = Object.entries(modules).map(([path, load]) => {
  const names: string[] = [];
  const source = path.replace(/^.*\/src\/app/, "").replace(/\/route\.ts$/, "").replace(/\[([^\]]+)\]/g, (_, name) => { names.push(name); return "([^/]+)"; });
  return { pattern: new RegExp(`^${source}$`), names, load };
});
export function installLocalApi() {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    if (!raw.startsWith("/api/")) {
      if (isTauri() && /^https?:/i.test(raw)) {
        if (new URL(raw).protocol !== "https:") throw new Error("模型服务必须使用 HTTPS。");
        return nativeFetch(input, init);
      }
      return original(input, init);
    }
    return exclusive(async () => {
      const request = new NextRequest(new URL(raw, "https://local.renewal.invalid"), init);
      markLocalRequest(request);
      if (raw === "/api/auth/logout") {
        const { clearLocalSession } = await import("./account");
        clearLocalSession();
        return Response.json({ ok: true });
      }
      if (!localSession()) {
        if (request.method === "GET") {
          try {
            const url = new URL(raw, "https://local.renewal.invalid");
            const path = url.pathname;
            if (["/account", "/settings", "/echoes", "/story", "/create-from-chat", "/dream", "/groups"].some(root => path === root || path.startsWith(`${root}/`))) {
              const { setPendingPath } = await import("./account");
              setPendingPath(path + url.search + url.hash);
            }
          } catch { /* Ignore malformed navigation paths. */ }
        }
        return Response.json({ error: "请先解锁本地账户。" }, { status: 401 });
      }
      if (raw === "/api/me/account" && request.method === "DELETE") {
        const body = await request.json().catch(() => ({}));
        if (body.confirmation !== "删除我的账号") return Response.json({ error: "请输入完整的删除确认文字。" }, { status: 400 });
        await deleteLocalAccount();
        return Response.json({ deleted: true, sessionCleared: true });
      }
      if (request.signal.aborted) return Response.json({ error: "请求已取消。" }, { status: 499 });
      const route = request.nextUrl.pathname === "/api/local/groups/run" ? { pattern: /^\/api\/local\/groups\/run$/, names: [] as string[], load: () => import("./group-jobs") as Promise<RouteModule> } : routes.find(item => item.pattern.test(request.nextUrl.pathname));
      if (!route) return Response.json({ error: "本地接口不存在。" }, { status: 404 });
      const before = JSON.stringify(snapshot());
      try {
        const match = request.nextUrl.pathname.match(route.pattern)!;
        const params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
        const routeModule = await route.load();
        const handler = routeModule[request.method];
        if (!handler) return Response.json({ error: "操作不受支持。" }, { status: 405 });
        requireLocalSession();
        const response = await handler(request, { params: Promise.resolve(params) });
        if (JSON.stringify(snapshot()) !== before) await persistActiveState();
        return response;
      } catch {
        await reloadActiveState();
        return Response.json({ error: "本地操作未完成，请检查配置或备份后重试。" }, { status: 503 });
      }
    });
  };
}
