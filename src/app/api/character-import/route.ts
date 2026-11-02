import { getCurrentSession } from "@/lib/auth/session";
import { privateJson } from "@/lib/http/private-response";
import { readJsonObject, JsonRequestError } from "@/lib/http/json";
import { persistenceUnavailableResponse } from "@/lib/http/persistence-errors";
import { analyzeChatCharacter, previewChatCharacter, CharacterModelError } from "@/lib/import/character-service";
import { CharacterImportValidationError, characterDraftToCompanion, validateCharacterDraft } from "@/lib/import/character-draft";
import { CompanionValidationError, getRenewalService } from "@/lib/renewal/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    const body = await readJsonObject(request);
    if (body.action === "analyze") return privateJson(await analyzeChatCharacter(session.userId, body));
    if (body.action === "preview") return privateJson(await previewChatCharacter(session.userId, body));
    if (body.action === "create") {
      const draft = validateCharacterDraft(body.draft);
      const companion = await getRenewalService(session.userId).createCompanion(characterDraftToCompanion(draft));
      return privateJson({ companion }, { status: 201 });
    }
    return privateJson({ error: "请选择提炼、试聊或创建操作。" }, { status: 400 });
  } catch (error) {
    const persistenceError = persistenceUnavailableResponse(error, "renewal");
    if (persistenceError) return persistenceError;
    if (error instanceof CharacterImportValidationError) return privateJson({ error: error.message }, { status: 400 });
    if (error instanceof JsonRequestError || error instanceof CompanionValidationError) return privateJson({ error: "资料格式无效，请检查后重试。" }, { status: 400 });
    if (error instanceof CharacterModelError) return privateJson({ error: error.message }, { status: 502 });
    return privateJson({ error: "暂时无法完成，请保留当前内容并稍后重试。" }, { status: 500 });
  }
}
