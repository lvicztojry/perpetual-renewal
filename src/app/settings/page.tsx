import { UserSettings } from "@/components/user-settings";
import { getOptionalSession, isLocalEmailAuthEnabled } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  if (!isLocalEmailAuthEnabled() && !(await getOptionalSession())) redirect("/login");
  return <UserSettings />;
}
