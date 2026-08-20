import { NextResponse } from "next/server";
import { clearCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearCurrentSession();
  return NextResponse.json({ ok: true });
}
