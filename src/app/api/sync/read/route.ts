import { privateJson } from "@/lib/http/private-response";
import { readLimitedJsonObject } from "@/lib/http/json";
import { readReceiptFailure, readReceiptSession } from "@/lib/sync/read-receipts-http";
import { createReadReceiptService } from "@/lib/sync/read-receipts-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const session = await readReceiptSession(request);
    const body = await readLimitedJsonObject(request, 16384);
    return privateJson(await createReadReceiptService().mark(session.userId, body));
  } catch (error) { return readReceiptFailure(error); }
}
