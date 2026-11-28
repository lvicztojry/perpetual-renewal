import { privateJson } from "@/lib/http/private-response";
import { readReceiptFailure, readReceiptSession } from "@/lib/sync/read-receipts-http";
import { createReadReceiptService } from "@/lib/sync/read-receipts-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  try {
    const session = await readReceiptSession();
    return privateJson(await createReadReceiptService().inbox(session.userId));
  } catch (error) { return readReceiptFailure(error); }
}
