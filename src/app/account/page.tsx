import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/session";
import { getUserProfile } from "@/lib/users/profile";
import { PersonalAccount } from "@/components/personal-account";

export const metadata: Metadata = { title: "我的账号 · 生生不息" };

export default async function AccountPage() {
  const session = await getOptionalSession();
  if (!session) redirect("/login");
  const user = await getUserProfile(session.userId);
  return <PersonalAccount initialUser={user} passwordAccount={session.provider === "password"} />;
}
