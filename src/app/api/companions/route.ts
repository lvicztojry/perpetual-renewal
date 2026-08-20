import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getRenewalService } from "@/lib/renewal/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  const companions = await getRenewalService(session.userId).listCompanions();
  return NextResponse.json({ companions });
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    const companion = await getRenewalService(session.userId).createCompanion(await request.json());
    return NextResponse.json({ companion }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create companion." },
      { status: 400 }
    );
  }
}
