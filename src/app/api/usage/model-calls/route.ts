import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getUsageDashboard } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  const { searchParams } = new URL(request.url);
  const rangeDays = Number(searchParams.get("rangeDays") ?? 7);
  const dashboard = await getUsageDashboard(session.userId, rangeDays);

  return NextResponse.json({ dashboard });
}

