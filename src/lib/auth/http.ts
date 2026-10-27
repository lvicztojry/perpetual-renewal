import { privateJson } from "@/lib/http/private-response";
import { JsonRequestError, jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { AuthError, AuthenticationRequiredError } from "./errors";

export async function authPost(request: Request, operation: (body: Record<string, unknown>) => Promise<unknown>) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new AuthError("请求来源无效。", 403);
    const origin = request.headers.get("origin");
    const expected = process.env.AUTH_APP_URL || request.url;
    if (origin && new URL(origin).origin !== new URL(expected).origin) throw new AuthError("请求来源无效。", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new AuthError("请求必须为 JSON。", 415);
    }
    return privateJson(await operation(await readJsonObject(request)));
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, { status: error.status });
    if (error instanceof AuthenticationRequiredError) return privateJson({ error: "Authentication required." }, { status: 401 });
    if (error instanceof JsonRequestError) return privateJson({ error: jsonErrorMessage(error, "Invalid JSON body.") }, { status: 400 });
    // Do not serialize/log Prisma, request, network or upstream error contents.
    return privateJson({ error: "认证服务暂不可用，请稍后重试。" }, { status: 503 });
  }
}
