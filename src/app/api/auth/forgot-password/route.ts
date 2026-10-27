import { authPost } from "@/lib/auth/http";
import { forgotPassword } from "@/lib/auth/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return authPost(request, (body) => forgotPassword(body.email));
}
