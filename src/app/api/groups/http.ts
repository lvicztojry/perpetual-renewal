import { AuthenticationRequiredError, getOptionalSession } from "@/lib/auth/session";
import { privateJson } from "@/lib/http/private-response";
import { isTrustedMutationOrigin } from "@/lib/http/request-origin";
import { GroupError } from "@/lib/groups/errors";

export async function groupSession(request: Request, mutation = false) {
  const session = await getOptionalSession();
  if (!session) throw new AuthenticationRequiredError();
  if (mutation && !isTrustedMutationOrigin(request)) throw new GroupError(403, "仅允许同源请求。");
  return session;
}
export function groupFailure(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return privateJson({ error: "请先登录。" }, { status: 401 });
  if (error instanceof GroupError) return privateJson({ error: error.message }, { status: error.status });
  return privateJson({ error: "群聊暂时不可用，请稍后重试。" }, { status: 503 });
}
