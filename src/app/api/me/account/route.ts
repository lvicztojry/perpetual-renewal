import { NextResponse } from "next/server";
import { clearCurrentSession, getCurrentSession } from "@/lib/auth/session";
import {
  ACCOUNT_DELETE_CONFIRMATION,
  DeleteAccountValidationError,
  deleteCurrentUserAccount,
  isFallbackDemoAccount
} from "@/lib/users/delete-account";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a valid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  try {
    const session = await getCurrentSession();
    const summary = await deleteCurrentUserAccount(session.userId, {
      confirmation: (body as { confirmation?: unknown }).confirmation
    });
    await clearCurrentSession();

    return NextResponse.json({
      deleted: true,
      persistence: summary.persistence,
      counts: summary.counts,
      sessionCleared: true,
      fallbackDemoAccount: isFallbackDemoAccount(session.userId),
      confirmationRequired: ACCOUNT_DELETE_CONFIRMATION
    });
  } catch (error) {
    if (error instanceof DeleteAccountValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          confirmationRequired: ACCOUNT_DELETE_CONFIRMATION
        },
        { status: 400 }
      );
    }

    throw error;
  }
}
