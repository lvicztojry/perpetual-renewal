import { GroupService } from "@/lib/groups/service";
import { createRenewalRepository } from "@/lib/renewal/repository";
import { requireLocalSession } from "./account";
export async function POST() {
  const session = requireLocalSession();
  const service = new GroupService();
  const repository = createRenewalRepository();
  const cursor = await repository.getProactiveSchedulerCheckpoint!("native-groups");
  const groups = (await service.list(session.userId)).sort((a, b) => a.id.localeCompare(b.id));
  const remaining = groups.filter(group => !cursor || group.id > cursor);
  const batch = remaining.slice(0, 3);
  for (const group of batch) { try { await service.scheduled(session.userId, group.id); } catch { /* Retry in a future fair scan. */ } }
  await repository.setProactiveSchedulerCheckpoint!("native-groups", remaining.length > batch.length ? batch.at(-1)?.id ?? null : null, cursor);
  return Response.json({ checked: batch.length });
}
