import { NextResponse } from "next/server";
import { createEmailSession, normalizeEmail } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { getUserProfile } from "@/lib/users/profile";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = await readJsonObject(request);
  } catch (error) {
    return NextResponse.json(
      { error: jsonErrorMessage(error, "Failed to login.") },
      { status: 400 }
    );
  }

  try {
    if (typeof body.email !== "string") {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }

    const email = normalizeEmail(body.email);
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : undefined;
    const session = await createEmailSession({ email, nickname });
    const user = await getUserProfile(session.userId);

    return NextResponse.json({ session, user });
  } catch (error) {
    return NextResponse.json({ error: safeLoginErrorMessage(error) }, { status: 400 });
  }
}

function safeLoginErrorMessage(error: unknown) {
  if (error instanceof Error && error.message === "请输入有效的邮箱地址。") {
    return error.message;
  }

  return "Failed to login.";
}
