import { getOptionalSession, AuthenticationRequiredError } from "@/lib/auth/session";
import { privateJson } from "@/lib/http/private-response";
import { JsonRequestError } from "@/lib/http/json";
import { DreamService } from "@/lib/dream/service";
import { DreamError } from "@/lib/dream/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ companionId: string }> };
function failure(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return privateJson({ error: "请先登录。" }, { status: 401 });
  if (error instanceof DreamError) return privateJson({ error: error.message }, { status: error.status });
  if (error instanceof JsonRequestError) return privateJson({ error: "梦境参数无效。" }, { status: 400 });
  return privateJson({ error: "梦境暂时不可用，请稍后重试。" }, { status: 503 });
}
export async function GET(_request: Request, context: Context) {
  try {
    const session = await getOptionalSession();
    if (!session) throw new AuthenticationRequiredError();
    const { userId } = session;
    return privateJson(await new DreamService().get(userId, (await context.params).companionId));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const session = await getOptionalSession();
    if (!session) throw new AuthenticationRequiredError();
    // Session does authentication only. Fail closed on absent/null/foreign Origin.
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return privateJson({ error: "仅允许同源请求。" }, { status: 403 });
    const { userId } = session;
    const companionId = (await context.params).companionId;
    const service = new DreamService();
    await service.get(userId, companionId);
    // Stream with a byte cap, including when Content-Length is absent/forged.
    const reader = request.body?.getReader();
    if (!reader) throw new JsonRequestError();
    const decoder = new TextDecoder();
    let body = "", bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 100000) { await reader.cancel(); throw new JsonRequestError(); }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new JsonRequestError(); }
    return privateJson(await service.post(userId, companionId, input));
  } catch (error) { return failure(error); }
}
