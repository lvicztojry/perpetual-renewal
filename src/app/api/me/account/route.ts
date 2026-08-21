import { NextResponse } from "next/server";
import { clearCurrentSession, getCurrentSession } from "@/lib/auth/session";
import { JsonRequestError, jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import {
  ACCOUNT_DELETE_CONFIRMATION,
  DeleteAccountValidationError,
  deleteCurrentUserAccount,
  isFallbackDemoAccount
} from "@/lib/users/delete-account";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const body = await readJsonObject(request);
    const session = await getCurrentSession();
    const summary = await deleteCurrentUserAccount(session.userId, {
      confirmation: body.confirmation
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

    if (error instanceof JsonRequestError) {
      return NextResponse.json(
        { error: jsonErrorMessage(error, "Failed to delete account.") },
        { status: 400 }
      );
    }

    throw error;
  }
}
