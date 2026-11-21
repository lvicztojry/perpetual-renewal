import { AuthenticationRequiredError, getOptionalSession } from "@/lib/auth/session";
import { privateJson } from "@/lib/http/private-response";
import { isTrustedMutationOrigin } from "@/lib/http/request-origin";
import { installStarterPack } from "@/lib/starters/install";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await getOptionalSession();
    if (!session) throw new AuthenticationRequiredError();
    if (!isTrustedMutationOrigin(request)) {
      return privateJson({ error: "仅允许同源请求。" }, { status: 403 });
    }
    return privateJson(await installStarterPack(session.userId));
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return privateJson({ error: "请先登录。" }, { status: 401 });
    }
    return privateJson({ error: "暂时未能添加留灯会，请稍后重试。" }, { status: 503 });
  }
}
