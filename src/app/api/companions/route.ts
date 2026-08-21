import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { getRenewalService } from "@/lib/renewal/service";
import type { CreateCompanionInput } from "@/lib/renewal/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  const companions = await getRenewalService(session.userId).listCompanions();
  return NextResponse.json({ companions });
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    const companion = await getRenewalService(session.userId).createCompanion(
      (await readJsonObject(request)) as unknown as CreateCompanionInput
    );
    return NextResponse.json({ companion }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: jsonErrorMessage(error, "Failed to create companion.") },
      { status: 400 }
    );
  }
}
