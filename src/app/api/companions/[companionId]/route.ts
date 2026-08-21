import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import {
  companionValidationErrorMessage,
  CompanionValidationError,
  getRenewalService
} from "@/lib/renewal/service";
import type { UpdateCompanionInput } from "@/lib/renewal/types";

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
    return privateJson({ error: "Companion not found." }, { status: 404 });
  }

  return privateJson({ companion });
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { companionId } = await context.params;
    const session = await getCurrentSession();
    const companion = await getRenewalService(session.userId).updateCompanion(
      companionId,
      (await readJsonObject(request)) as unknown as UpdateCompanionInput
    );

    if (!companion) {
      return privateJson({ error: "Companion not found." }, { status: 404 });
    }

    return privateJson({ companion });
  } catch (error) {
    if (error instanceof CompanionValidationError) {
      return privateJson({ error: companionValidationErrorMessage(error) }, { status: 400 });
    }

    return privateJson(
      { error: jsonErrorMessage(error, "Failed to update companion.") },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { companionId } = await context.params;
  const session = await getCurrentSession();
  const deleted = await getRenewalService(session.userId).deleteCompanion(companionId);

  if (!deleted) {
    return privateJson({ error: "Companion not found." }, { status: 404 });
  }

  return privateJson({ deleted: true, companionId });
}
