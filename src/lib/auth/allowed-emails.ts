import { AuthError } from "./errors";

// Unset preserves existing deployments. Explicitly empty closes access to everyone.
export function isEmailAllowed(email: string): boolean {
  const configured = process.env.AUTH_ALLOWED_EMAILS;
  if (configured === undefined) return true;
  return Boolean(email.trim()) && configured.split(",").some(value => value.trim().toLowerCase() === email.trim().toLowerCase());
}

export function assertEmailAllowed(email: string) {
  if (!isEmailAllowed(email)) throw new AuthError("当前仅向受邀邮箱开放，请联系邀请人。", 403);
}
