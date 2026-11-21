import { GroupService } from "@/lib/groups/service";
import { readGroupBody } from "@/lib/groups/validation";
import { privateJson } from "@/lib/http/private-response";
import { groupFailure, groupSession } from "./http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const { userId } = await groupSession(request); return privateJson({ userId, groups: await new GroupService().list(userId) }); }
  catch (error) { return groupFailure(error); }
}
export async function POST(request: Request) {
  try { const { userId } = await groupSession(request, true); return privateJson({ group: await new GroupService().create(userId, await readGroupBody(request)) }); }
  catch (error) { return groupFailure(error); }
}
