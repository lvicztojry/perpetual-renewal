import { NextResponse } from "next/server";
import { createEmailSession, normalizeEmail } from "@/lib/auth/session";
import { getUserProfile } from "@/lib/users/profile";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: unknown;
      nickname?: unknown;
    };

    if (typeof body.email !== "string") {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }

    const email = normalizeEmail(body.email);
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : undefined;
    const session = await createEmailSession({ email, nickname });
    const user = await getUserProfile(session.userId);

    return NextResponse.json({ session, user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to login." },
      { status: 400 }
    );
  }
}
