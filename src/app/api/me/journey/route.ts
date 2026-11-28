import { getOptionalSession, AuthenticationRequiredError } from "@/lib/auth/session";
import { privateJson } from "@/lib/http/private-response";
import { isTrustedMutationOrigin } from "@/lib/http/request-origin";
import { JsonRequestError, readLimitedJsonObject } from "@/lib/http/json";
import { JourneyError, JourneyService } from "@/lib/journey/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function failure(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return privateJson({ error: "请先登录。" }, { status: 401 });
  if (error instanceof JourneyError) return privateJson({ error: error.message, ...error.current }, { status: error.status });
  if (error instanceof JsonRequestError) return privateJson({ error: "引导参数无效。" }, { status: 400 });
  return privateJson({ error: "引导暂时不可用，请稍后重试。" }, { status: 503 });
}
export async function GET() {
  try {
    const session = await getOptionalSession();
    if (!session) throw new AuthenticationRequiredError();
    return privateJson(await new JourneyService().get(session.userId));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await getOptionalSession();
    if (!session) throw new AuthenticationRequiredError();
    if (!isTrustedMutationOrigin(request)) return privateJson({ error: "仅允许同源请求。" }, { status: 403 });
    return privateJson(await new JourneyService().post(session.userId, await readLimitedJsonObject(request, 4096)));
  } catch (error) { return failure(error); }
}
