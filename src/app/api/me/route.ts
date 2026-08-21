import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { JsonRequestError, jsonErrorMessage, readJsonObject } from "@/lib/http/json";
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
    const body = await readJsonObject(request);
    const user = await updateUserProfile(session.userId, body);

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof JsonRequestError) {
      return NextResponse.json(
        { error: jsonErrorMessage(error, "Failed to update profile.") },
        { status: 400 }
      );
    }

    if (error instanceof ProfileValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }
}
