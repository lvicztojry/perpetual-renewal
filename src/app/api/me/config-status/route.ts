import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getConfigReadinessSnapshot } from "@/lib/config/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  const configStatus = await getConfigReadinessSnapshot(session.userId);
  return NextResponse.json({ configStatus });
}
