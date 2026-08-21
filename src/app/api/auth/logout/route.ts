import { privateJson } from "@/lib/http/private-response";
import { clearCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearCurrentSession();
  return privateJson({ ok: true });
}
