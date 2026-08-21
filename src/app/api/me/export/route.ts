import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { buildUserExportSnapshot } from "@/lib/export/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  const snapshot = await buildUserExportSnapshot(session.userId);

  return privateJson(snapshot, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
