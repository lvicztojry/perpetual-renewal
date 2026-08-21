import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { getUsageDashboard } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  const { searchParams } = new URL(request.url);
  const rangeDays = readRangeDays(searchParams.get("rangeDays"));
  if (!rangeDays) {
    return privateJson({ error: "Invalid usage range." }, { status: 400 });
  }

  const dashboard = await getUsageDashboard(session.userId, rangeDays);

  return privateJson({ dashboard });
}

function readRangeDays(value: string | null) {
  if (value === null || value.trim() === "") return 7;

  const rangeDays = Number(value);
  if (!Number.isFinite(rangeDays)) return null;

  const rounded = Math.round(rangeDays);
  if (rounded < 1 || rounded > 90) return null;

  return rounded;
}
