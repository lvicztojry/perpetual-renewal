import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";
import {
  companionValidationErrorMessage,
  CompanionValidationError,
  getRenewalService
} from "@/lib/renewal/service";
import type { CreateCompanionInput } from "@/lib/renewal/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getCurrentSession();
    const companions = await getRenewalService(session.userId).listCompanions();
    return privateJson({ companions });
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "workspace");
    if (persistenceError) return persistenceError;

    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    const companion = await getRenewalService(session.userId).createCompanion(
      (await readJsonObject(request)) as unknown as CreateCompanionInput
    );
    return privateJson({ companion }, { status: 201 });
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "renewal");
    if (persistenceError) return persistenceError;

    if (error instanceof CompanionValidationError) {
      return privateJson({ error: companionValidationErrorMessage(error) }, { status: 400 });
    }

    return privateJson(
      { error: jsonErrorMessage(error, "Failed to create companion.") },
      { status: 400 }
    );
  }
}
