import { authPost } from "@/lib/auth/http";
import { authenticatePassword, normalizeEmail } from "@/lib/auth/service";
import { createEmailSession, createPasswordSession } from "@/lib/auth/session";
import { isLocalEmailAuthEnabled } from "@/lib/auth/errors";
import { getUserProfile } from "@/lib/users/profile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return authPost(request, async (body) => {
    const email = normalizeEmail(body.email);
    const session = isLocalEmailAuthEnabled() && body.password === undefined
      ? await createEmailSession({ email, nickname: typeof body.nickname === "string" ? body.nickname : undefined })
      : await createPasswordSession(await authenticatePassword(email, body.password));
    const user = await getUserProfile(session.userId);
    return { session, user };
  });
}
