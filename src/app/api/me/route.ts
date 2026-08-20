import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import {
  getUserProfile,
  ProfileValidationError,
  updateUserProfile
} from "@/lib/users/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  const user = await getUserProfile(session.userId);

  return NextResponse.json({
    session: {
      provider: session.provider,
      replaceWith: "Auth.js or another production session provider"
    },
    user
  });
}

export async function PATCH(request: Request) {
  try {
    const session = await getCurrentSession();
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Expected a valid JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
    }

    const user = await updateUserProfile(session.userId, body);

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }
}
