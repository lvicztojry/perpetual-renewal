import { NextResponse } from "next/server";

const privateNoStoreCacheControl = "private, no-store, max-age=0, must-revalidate";
const privateVaryHeaders = ["Cookie", "Authorization"];

export function privateJson<TBody>(body: TBody, init?: ResponseInit) {
  return NextResponse.json(body, withPrivateNoStore(init));
}

export function withPrivateNoStore(init: ResponseInit = {}): ResponseInit {
  return {
    ...init,
    headers: privateNoStoreHeaders(init.headers)
  };
}

export function privateNoStoreHeaders(headersInit?: HeadersInit) {
  const headers = new Headers(headersInit);
  headers.set("Cache-Control", privateNoStoreCacheControl);
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("Surrogate-Control", "no-store");
  headers.set("Vary", mergeVary(headers.get("Vary")));
  return headers;
}

function mergeVary(existing: string | null) {
  const values = new Map<string, string>();
  for (const value of existing?.split(",") ?? []) {
    const trimmed = value.trim();
    if (trimmed) values.set(trimmed.toLowerCase(), trimmed);
  }

  for (const value of privateVaryHeaders) {
    values.set(value.toLowerCase(), value);
  }

  return Array.from(values.values()).join(", ");
}
