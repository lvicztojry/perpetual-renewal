import { timingSafeEqual } from "node:crypto";
import { privateJson } from "@/lib/http/private-response";
import { listScheduledGroups } from "@/lib/groups/repository";
import { GroupService } from "@/lib/groups/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 240;
function authorized(request: Request) {
  const supplied = request.headers.get("authorization") ?? "";
  return [process.env.PROACTIVE_CRON_SECRET, process.env.CRON_SECRET].some(value => {
    if (!value?.trim()) return false;
    const expected = Buffer.from(`Bearer ${value.trim()}`), received = Buffer.from(supplied);
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
export async function GET(request: Request) {
  if (!authorized(request)) return privateJson({ error: "需要调度授权。" }, { status: 401 });
  const after = new URL(request.url).searchParams.get("after") ?? undefined;
  if (after && after.length > 128) return privateJson({ error: "调度参数无效。" }, { status: 400 });
  try {
    const groups = await listScheduledGroups(3, after);
    const service = new GroupService();
    let generated = 0, failed = 0;
    for (const group of groups) {
      try {
        const result = await service.scheduled(group.userId, group.id);
        if (result.group.messages.length > group.messages.length) generated++;
      } catch { failed++; }
    }
    return privateJson({ scanned: groups.length, generated, failed, nextCursor: groups.length === 3 ? groups.at(-1)!.id : null });
  } catch { return privateJson({ error: "群聊调度暂时不可用。" }, { status: 503 }); }
}
