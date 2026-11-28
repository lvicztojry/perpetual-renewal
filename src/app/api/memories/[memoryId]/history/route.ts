import { getOptionalSession } from "@/lib/auth/session";
import { privateJson } from "@/lib/http/private-response";
import { isTrustedMutationOrigin } from "@/lib/http/request-origin";
import { JsonRequestError, readLimitedJsonObject } from "@/lib/http/json";
import { MemoryLifecycleError } from "@/lib/memory/lifecycle";
import { readMemoryHistory, supersedeMemory } from "@/lib/memory/lifecycle-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ memoryId: string }> };
function failure(error: unknown) {
  if (error instanceof JsonRequestError) return privateJson({ error: "记忆修改参数无效。" }, { status: 400 });
  return error instanceof MemoryLifecycleError ? privateJson({ error: error.message }, { status: error.status })
    : privateJson({ error: "记忆记录暂时不可用，请稍后重试。" }, { status: 503 });
}
export async function GET(request: Request, context: Context) {
  try {
    const session = await getOptionalSession();
    if (!session) return privateJson({ error: "请先登录。" }, { status: 401 });
    const cursor = new URL(request.url).searchParams.get("before") ?? undefined;
    if (cursor && cursor.length > 128) return privateJson({ error: "分页参数无效。" }, { status: 400 });
    return privateJson(await readMemoryHistory(session.userId, (await context.params).memoryId, cursor));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const session = await getOptionalSession();
    if (!session) return privateJson({ error: "请先登录。" }, { status: 401 });
    if (!isTrustedMutationOrigin(request)) return privateJson({ error: "仅允许同源操作。" }, { status: 403 });
    const body = await readLimitedJsonObject(request);
    return privateJson({ memories: await supersedeMemory(session.userId, (await context.params).memoryId, body) });
  } catch (error) { return failure(error); }
}
