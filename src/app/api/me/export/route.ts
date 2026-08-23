import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { buildUserExportSnapshot } from "@/lib/export/snapshot";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getCurrentSession();
    const snapshot = await buildUserExportSnapshot(session.userId);

    return privateJson(snapshot, {
      headers: {
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "export");
    if (persistenceError) return persistenceError;

    throw error;
  }
}
