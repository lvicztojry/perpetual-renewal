import { RenewalWorkspace } from "@/components/renewal-workspace";
import { getOptionalSession, isLocalEmailAuthEnabled } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function Home() {
  if (!isLocalEmailAuthEnabled() && !(await getOptionalSession())) redirect("/login");
  return <RenewalWorkspace />;
}
