import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getRenewalService } from "@/lib/renewal/service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ companionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { companionId } = await context.params;
  const session = await getCurrentSession();
  const companion = await getRenewalService(session.userId).listCompanions().then((companions) =>
    companions.find((item) => item.id === companionId)
  );

  if (!companion) {
    return NextResponse.json({ error: "Companion not found." }, { status: 404 });
  }

  return NextResponse.json({ companion });
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { companionId } = await context.params;
    const session = await getCurrentSession();
    const companion = await getRenewalService(session.userId).updateCompanion(
      companionId,
      await request.json()
    );

    if (!companion) {
      return NextResponse.json({ error: "Companion not found." }, { status: 404 });
    }

    return NextResponse.json({ companion });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update companion." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { companionId } = await context.params;
  const session = await getCurrentSession();
  const deleted = await getRenewalService(session.userId).deleteCompanion(companionId);

  if (!deleted) {
    return NextResponse.json({ error: "Companion not found." }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, companionId });
}
