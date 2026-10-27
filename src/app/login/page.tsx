import { LoginForm } from "@/components/login-form";
import { isLocalEmailAuthEnabled } from "@/lib/auth/session";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const { mode } = await searchParams;
  const initialMode = mode === "password" ? "login" : mode === "forgot" ? "forgot"
    : mode === "register" ? "register" : undefined;
  return <LoginForm key={initialMode ?? "default"} allowLocalEmail={isLocalEmailAuthEnabled()} initialMode={initialMode} />;
}
