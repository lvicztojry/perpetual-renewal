import { GroupService } from "@/lib/groups/service";
import { readGroupBody } from "@/lib/groups/validation";
import { privateJson } from "@/lib/http/private-response";
import { groupFailure, groupSession } from "../http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ groupId: string }> };
export async function GET(request: Request, context: Context) {
  try { const { userId } = await groupSession(request); const service = new GroupService(), id = (await context.params).groupId; return privateJson({ group: await service.get(userId, id), progress: await service.progress(userId, id) }); }
  catch (error) { return groupFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { userId } = await groupSession(request, true), { groupId } = await context.params;
    const service = new GroupService();
    await service.get(userId, groupId);
    return privateJson(await service.post(userId, groupId, await readGroupBody(request)));
  } catch (error) { return groupFailure(error); }
}
export async function DELETE(request: Request, context: Context) {
  try { const { userId } = await groupSession(request, true); await new GroupService().delete(userId, (await context.params).groupId); return privateJson({ deleted: true }); }
  catch (error) { return groupFailure(error); }
}
