import { RenewalWorkspace } from "@/components/renewal-workspace";
import { getOptionalSession, isLocalEmailAuthEnabled } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getOptionalSession();
  if (!isLocalEmailAuthEnabled() && !session) redirect("/login");
  return <RenewalWorkspace signedIn={Boolean(session)} />;
}
