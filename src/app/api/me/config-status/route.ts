import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { getConfigReadinessSnapshot } from "@/lib/config/status";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getCurrentSession();
    const configStatus = await getConfigReadinessSnapshot(session.userId);
    return privateJson({ configStatus });
  } catch (error) {
    const failure = persistenceUnavailableResponse(error, "profile");
    if (failure) return failure;
    throw error;
  }
}
