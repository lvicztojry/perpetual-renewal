import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "重置密码 · 生生不息",
  referrer: "no-referrer",
  robots: { index: false, follow: false }
};

export default function ResetPasswordPage() {
  return <LoginForm initialMode="reset" />;
}
