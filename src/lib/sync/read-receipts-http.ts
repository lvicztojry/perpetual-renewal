import { getOptionalSession } from "@/lib/auth/session";
import { JsonRequestError } from "@/lib/http/json";
import { privateJson } from "@/lib/http/private-response";
import { isTrustedMutationOrigin } from "@/lib/http/request-origin";
import { ReadReceiptError } from "./read-receipts-core";

export async function readReceiptSession(request?: Request) {
  const session = await getOptionalSession();
  if (!session) throw new ReadReceiptError(401, "请先登录。");
  if (request && !isTrustedMutationOrigin(request)) {
    throw new ReadReceiptError(403, "仅允许同源请求。");
  }
  return session;
}
export function readReceiptFailure(error: unknown) {
  if (error instanceof ReadReceiptError) return privateJson({ error: error.message }, { status: error.status });
  if (error instanceof JsonRequestError) return privateJson({ error: "已读请求无效。" }, { status: 400 });
  return privateJson({ error: "消息同步暂时不可用，请稍后重试。" }, { status: 503 });
}
