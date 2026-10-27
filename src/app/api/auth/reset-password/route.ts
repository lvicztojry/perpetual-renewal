import { authPost } from "@/lib/auth/http";
import { resetPassword } from "@/lib/auth/service";
import { clearCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return authPost(request, async (body) => {
    await resetPassword(body.token, body.password);
    await clearCurrentSession();
    return { ok: true };
  });
}
