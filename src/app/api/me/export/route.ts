import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { buildUserExportSnapshot } from "@/lib/export/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  const snapshot = await buildUserExportSnapshot(session.userId);

  return NextResponse.json(snapshot, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
