import { AuthenticationRequiredError, getOptionalSession } from "@/lib/auth/session";
import { privateJson } from "@/lib/http/private-response";
import { GroupError } from "@/lib/groups/errors";

export async function groupSession(request: Request, mutation = false) {
  const session = await getOptionalSession();
  if (!session) throw new AuthenticationRequiredError();
  const origin = request.headers.get("origin");
  if (mutation && (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site")) throw new GroupError(403, "仅允许同源请求。");
  return session;
}
export function groupFailure(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return privateJson({ error: "请先登录。" }, { status: 401 });
  if (error instanceof GroupError) return privateJson({ error: error.message }, { status: error.status });
  return privateJson({ error: "群聊暂时不可用，请稍后重试。" }, { status: 503 });
}
