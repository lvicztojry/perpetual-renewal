import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import {
  companionValidationErrorMessage,
  CompanionValidationError,
  getRenewalService
} from "@/lib/renewal/service";
import type { CreateCompanionInput } from "@/lib/renewal/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  const companions = await getRenewalService(session.userId).listCompanions();
  return privateJson({ companions });
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    const companion = await getRenewalService(session.userId).createCompanion(
      (await readJsonObject(request)) as unknown as CreateCompanionInput
    );
    return privateJson({ companion }, { status: 201 });
  } catch (error) {
    if (error instanceof CompanionValidationError) {
      return privateJson({ error: companionValidationErrorMessage(error) }, { status: 400 });
    }

    return privateJson(
      { error: jsonErrorMessage(error, "Failed to create companion.") },
      { status: 400 }
    );
  }
}
