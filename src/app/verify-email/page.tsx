import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "验证邮箱 · 生生不息",
  referrer: "no-referrer",
  robots: { index: false, follow: false }
};

export default function VerifyEmailPage() {
  return <LoginForm initialMode="verify" />;
}
